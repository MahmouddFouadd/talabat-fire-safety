-- ═══════════════════════════════════════════════════════════════════
-- Security hardening (security review, 2026-11-21)
--  1. One inspection per store per week is enforced under concurrency with a clear error,
--     and every admin duplicate override gets its own audit row.
--  2. PIN sign-in: unknown accounts lock exactly like real ones, so "LOCKED" no longer
--     reveals which usernames / mobile numbers exist.
--  3. Audit log: rows record where the request came from (IP, user agent) and cannot be
--     changed or deleted by anyone through the API (including the service role).
--  4. Browser-side exports are written to the audit log (admin-only RPC).
--  5. Service-role helper to end every session of a user (password reset / deactivation).
--  6. Dashboard: open-issue KPIs count active stores only.
--  7. Defense in depth: API roles never hold TRUNCATE / TRIGGER / REFERENCES on app tables.
-- Safe to run more than once.
-- NOTE for future migrations: public.submit_inspection is now a thin wrapper; the inspection
-- logic lives in public._submit_inspection_impl. Redefine the IMPL, not the wrapper.
-- ═══════════════════════════════════════════════════════════════════

-- ── 7. no TRUNCATE etc. for API roles (TRUNCATE ignores RLS) ─────────
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- ── 3. audit source + immutability ───────────────────────────────────
create or replace function public.request_source() returns jsonb
language plpgsql stable set search_path = public as $$
declare h jsonb;
begin
  begin h := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then h := null; end;
  if h is null then return null; end if;
  return nullif(jsonb_strip_nulls(jsonb_build_object(
    'ip', nullif(trim(split_part(coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', h->>'x-forwarded-for', ''), ',', 1)), ''),
    'ua', left(h->>'user-agent', 200))), '{}'::jsonb);
end $$;

alter table public.audit_logs add column if not exists source jsonb;
alter table public.audit_logs alter column source set default public.request_source();

create or replace function public.audit_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'AUDIT_LOG_IMMUTABLE';
end $$;
drop trigger if exists trg_audit_immutable on public.audit_logs;
create trigger trg_audit_immutable before update or delete on public.audit_logs
  for each row execute function public.audit_immutable();
drop trigger if exists trg_audit_no_truncate on public.audit_logs;
create trigger trg_audit_no_truncate before truncate on public.audit_logs
  for each statement execute function public.audit_immutable();

-- ── 4. audited browser-side events (exports) ─────────────────────────
create or replace function public.log_event(p_action text, p_detail jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  if p_action not in ('export_csv', 'export_backup') then raise exception 'INVALID_ACTION'; end if;
  if p_detail is not null and length(p_detail::text) > 4000 then raise exception 'DETAIL_TOO_LARGE'; end if;
  insert into public.audit_logs(actor_auth, actor_staff, action, entity, entity_id, detail)
  values (auth.uid(), public.current_staff_id(), p_action, 'export', p_detail->>'table', p_detail);
end $$;

-- ── 1. submit_inspection: serialize per store+week, clean duplicate error, audit overrides ──
-- Move the existing implementation aside once (re-runs see the wrapper marker and skip).
do $$
declare src text;
begin
  select p.prosrc into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'submit_inspection' and pg_get_function_identity_arguments(p.oid) = 'p jsonb';
  if src is not null and position('submit-wrapper-v1' in src) = 0 then
    drop function if exists public._submit_inspection_impl(jsonb);
    alter function public.submit_inspection(jsonb) rename to _submit_inspection_impl;
  end if;
end $$;

create or replace function public.submit_inspection(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
-- submit-wrapper-v1: the real checks are in _submit_inspection_impl
declare
  v_client uuid;
  v_week date := public.week_start_of(public.cairo_today());
  v_store text := p->>'store_code';
  res jsonb; ex public.inspections; c text;
begin
  begin v_client := (p->>'client_id')::uuid; exception when others then raise exception 'CLIENT_ID_REQUIRED'; end;
  -- one submission at a time per store+week (two phones, double taps, retries racing each other)
  if v_store is not null then
    perform pg_advisory_xact_lock(hashtextextended('inspection:' || v_store || ':' || v_week::text, 0));
  end if;
  if v_client is not null then
    perform pg_advisory_xact_lock(hashtextextended('inspection-client:' || v_client::text, 0));
  end if;

  begin
    res := public._submit_inspection_impl(p);
  exception when unique_violation then
    get stacked diagnostics c = constraint_name;
    -- same client_id saved meanwhile → behave like a replay
    select * into ex from public.inspections where client_id = v_client;
    if ex.id is not null then
      if ex.tech_id is distinct from public.current_staff_id() and not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
      return jsonb_build_object('id', ex.id, 'code', ex.inspection_code, 'replayed', true, 'overall', ex.overall_status);
    end if;
    if c = 'inspections_one_per_week' then raise exception 'DUPLICATE_WEEK'; end if;
    raise;
  end;

  if not coalesce((res->>'replayed')::boolean, false) then
    select * into ex from public.inspections where id = (res->>'id')::uuid;
    if ex.duplicate_override then
      insert into public.audit_logs(actor_auth, actor_staff, action, entity, entity_id, detail)
      values (auth.uid(), public.current_staff_id(), 'duplicate_override', 'inspections', ex.inspection_code,
              jsonb_build_object('store_code', ex.store_code, 'week_start', ex.week_start, 'reason', ex.override_reason,
                                 'approved_by', public.current_staff_id(), 'approved_at', now()));
    end if;
  end if;
  return res;
end $$;

-- ── 2. PIN: identical lockout for unknown accounts (no enumeration) ──
create table if not exists public.pin_attempts (
  key          text primary key,               -- md5 of the normalized identifier, never the identifier itself
  failed       int not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);
alter table public.pin_attempts enable row level security;   -- no policies: invisible to app roles
revoke all on public.pin_attempts from anon, authenticated;
grant all on public.pin_attempts to service_role;

create or replace function public.pin_check(p_identifier text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v text := lower(trim(coalesce(p_identifier, ''))); s public.staff; e text; pr public.staff_pins;
        k text; pa public.pin_attempts; is_phone boolean;
begin
  is_phone := v ~ '^[+0-9 ()-]{8,20}$';
  if is_phone then
    if (select count(*) from public.staff st where st.active and st.phone is not null
          and public.normalize_phone(st.phone) = public.normalize_phone(v)) = 1 then
      select st.* into s from public.staff st where st.active and st.auth_user_id is not null and st.phone is not null
        and public.normalize_phone(st.phone) = public.normalize_phone(v);
    end if;
  else
    select st.* into s from public.staff st where st.active and st.auth_user_id is not null and st.username = v;
  end if;
  if s.id is not null then
    select * into pr from public.staff_pins where staff_id = s.id for update;
  end if;

  if pr.staff_id is null then
    -- no such account (or no PIN): count the attempt exactly like a real one, so the answers match
    perform crypt(coalesce(p_pin,''), gen_salt('bf', 8));
    k := md5('pin:' || case when is_phone then public.normalize_phone(v) else v end);
    insert into public.pin_attempts(key) values (k) on conflict (key) do nothing;
    select * into pa from public.pin_attempts where key = k for update;
    if pa.locked_until is not null and pa.locked_until > now() then return jsonb_build_object('error','LOCKED', 'until', pa.locked_until); end if;
    update public.pin_attempts set failed = failed + 1, updated_at = now(),
      locked_until = case when failed + 1 >= 15 then 'infinity'::timestamptz
                          when (failed + 1) % 5 = 0 then now() + interval '15 minutes' else locked_until end
     where key = k;
    delete from public.pin_attempts where updated_at < now() - interval '30 days' and (locked_until is null or locked_until < now());
    return jsonb_build_object('error','BAD');
  end if;

  if pr.locked_until is not null and pr.locked_until > now() then return jsonb_build_object('error','LOCKED', 'until', pr.locked_until); end if;

  if crypt(coalesce(p_pin,''), pr.pin_hash) = pr.pin_hash then
    update public.staff_pins set failed = 0, locked_until = null where staff_id = s.id;
    select email into e from auth.users where id = s.auth_user_id;
    insert into public.audit_logs(actor_auth, actor_staff, action, entity, entity_id) values (s.auth_user_id, s.id, 'pin_login', 'auth', s.id::text);
    return jsonb_build_object('ok', true, 'email', e);
  end if;

  update public.staff_pins set failed = failed + 1,
    locked_until = case when failed + 1 >= 15 then 'infinity'::timestamptz
                        when (failed + 1) % 5 = 0 then now() + interval '15 minutes' else locked_until end
   where staff_id = s.id;
  insert into public.audit_logs(actor_auth, actor_staff, action, entity, entity_id) values (null, s.id, 'pin_login_failed', 'auth', s.id::text);
  return jsonb_build_object('error','BAD');
end $$;

-- ── 5. end all sessions of a login (service role only; used by the admin-users function) ──
create or replace function public.revoke_user_sessions(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if p_user is null then return 0; end if;
  begin
    if to_regclass('auth.sessions') is not null then
      execute 'delete from auth.sessions where user_id = $1' using p_user;   -- refresh tokens go with their session
      get diagnostics n = row_count;
    end if;
    if to_regclass('auth.refresh_tokens') is not null then
      execute 'update auth.refresh_tokens set revoked = true where user_id = $1::text and not revoked' using p_user;
    end if;
  exception when insufficient_privilege then
    return -1;   -- platform refused: caller reports it; access tokens still expire on their own
  end;
  return n;
end $$;

-- ── 6. dashboard: issue KPIs from active stores only ─────────────────
create or replace function public.dashboard_summary(p_zone uuid default null) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare res jsonb; wk date := public.week_start_of(public.cairo_today());
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  with st as (select * from public.v_store_status where active and (p_zone is null or zone_id = p_zone)),
  iss as (select i.* from public.issues i join public.stores s using (store_code) where s.active and (p_zone is null or s.zone_id = p_zone))
  select jsonb_build_object(
    'week_start', wk,
    'today', public.cairo_today(),
    'stores', (select count(*) from st),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from st group by status) x),
    'no_base', (select count(*) from st where not has_base),
    'flagged', (select count(*) from st where flagged),
    'open_issues', (select count(*) from iss where status not in ('resolved','closed')),
    'issues_by_priority', (select coalesce(jsonb_object_agg(priority, n), '{}') from (select priority, count(*) n from iss where status not in ('resolved','closed') group by priority) x),
    'issues_by_equipment', (select coalesce(jsonb_object_agg(equipment, n), '{}') from (select equipment, count(*) n from iss where status not in ('resolved','closed') group by equipment) x),
    'issues_by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from iss group by status) x),
    'zones', (select coalesce(jsonb_agg(z order by z->>'sort', z->>'code'), '[]') from (
        select jsonb_build_object('id', zn.id, 'code', zn.code, 'name_ar', zn.name_ar, 'name_en', zn.name_en, 'sort', lpad(zn.sort::text,4,'0'),
          'stores', count(st.store_code), 'done', count(st.store_code) filter (where st.status in ('ok','issues')),
          'overdue', count(st.store_code) filter (where st.status in ('overdue','never'))) z
        from public.zones zn left join st on st.zone_id = zn.id where zn.active and (p_zone is null or zn.id = p_zone) group by zn.id) q),
    'techs', (select coalesce(jsonb_agg(t order by t->>'name'), '[]') from (
        select jsonb_build_object('id', sf.id, 'name', sf.full_name, 'stores', count(st.store_code),
          'done', count(st.store_code) filter (where st.status in ('ok','issues')),
          'overdue', count(st.store_code) filter (where st.status in ('overdue','never'))) t
        from public.staff sf join st on st.assigned_tech_id = sf.id group by sf.id) q),
    'trend', (select coalesce(jsonb_agg(jsonb_build_object('week_start', w, 'inspections', coalesce(n,0), 'with_issues', coalesce(b,0)) order by w), '[]') from (
        select gs::date w, x.n, x.b from generate_series(wk - 77, wk, interval '7 day') gs
        left join (select i.week_start, count(*) n, count(*) filter (where i.overall_status='warn') b
                   from public.inspections i join public.stores s using (store_code)
                   where p_zone is null or s.zone_id = p_zone group by i.week_start) x on x.week_start = gs::date) q)
  ) into res;
  return res;
end $$;

-- ── privileges ───────────────────────────────────────────────────────
revoke execute on all functions in schema public from public, anon;
grant execute on function public.public_settings(), public.login_email(text) to anon, authenticated;
grant execute on function public.submit_inspection(jsonb), public.log_event(text, jsonb), public.dashboard_summary(uuid) to authenticated;
revoke execute on function public._submit_inspection_impl(jsonb), public.revoke_user_sessions(uuid),
  public.pin_check(text, text), public.audit_immutable(), public.request_source() from authenticated;
grant execute on function public.revoke_user_sessions(uuid), public.pin_check(text, text), public.request_source() to service_role;
-- request_source() is a column default: the role inserting the audit row must be able to run it
grant execute on function public.request_source() to authenticated;
