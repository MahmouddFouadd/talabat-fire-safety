-- ═══════════════════════════════════════════════════════════════════
-- Identity helpers, RLS, audit, business RPCs
-- ═══════════════════════════════════════════════════════════════════

-- ── identity helpers (definer so they can read staff under RLS) ──────
create or replace function public.current_staff_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.staff where auth_user_id = auth.uid() and active limit 1
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.staff where auth_user_id = auth.uid() and active and role = 'admin')
$$;

create or replace function public.setting(k text, fallback jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.app_settings where key = k), fallback)
$$;

-- ── audit trigger ────────────────────────────────────────────────────
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_id text; v_detail jsonb;
begin
  v_id := coalesce(
    to_jsonb(coalesce(new, old))->>'store_code',
    to_jsonb(coalesce(new, old))->>'issue_code',
    to_jsonb(coalesce(new, old))->>'inspection_code',
    to_jsonb(coalesce(new, old))->>'key',
    to_jsonb(coalesce(new, old))->>'code',
    to_jsonb(coalesce(new, old))->>'id');
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value)) into v_detail
    from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and n.key not in ('updated_at');
    if v_detail is null then return new; end if;
  elsif tg_op = 'INSERT' then
    v_detail := to_jsonb(new) - 'updated_at' - 'created_at';
  else
    v_detail := to_jsonb(old);
  end if;
  insert into public.audit_logs(actor_auth, actor_staff, action, entity, entity_id, detail)
  values (auth.uid(), public.current_staff_id(), lower(tg_op), tg_table_name, v_id, v_detail);
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['zones','staff','stores','store_equipment','app_settings','equipment_types','issues','inspections'] loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ── guards on staff ──────────────────────────────────────────────────
create or replace function public.staff_guard() returns trigger
language plpgsql set search_path = public as $$  -- invoker on purpose: current_user must be the caller
begin
  -- logins are linked only by the admin-users Edge Function (service role) or by bootstrap
  if tg_op = 'UPDATE' and new.auth_user_id is distinct from old.auth_user_id
     and coalesce(auth.role(),'') <> 'service_role' and current_user not in ('postgres','supabase_admin','service_role') then
    raise exception 'AUTH_LINK_LOCKED';
  end if;
  if tg_op = 'INSERT' and new.auth_user_id is not null
     and coalesce(auth.role(),'') <> 'service_role' and current_user not in ('postgres','supabase_admin','service_role') then
    raise exception 'AUTH_LINK_LOCKED';
  end if;
  -- never leave the system without an active admin
  if tg_op = 'UPDATE' and old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active) then
    if not exists (select 1 from public.staff where id <> old.id and role = 'admin' and active) then
      raise exception 'LAST_ADMIN';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_staff_guard on public.staff;
create trigger trg_staff_guard before insert or update on public.staff for each row execute function public.staff_guard();

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.zones           enable row level security;
alter table public.staff           enable row level security;
alter table public.stores          enable row level security;
alter table public.equipment_types enable row level security;
alter table public.store_equipment enable row level security;
alter table public.app_settings    enable row level security;
alter table public.inspections     enable row level security;
alter table public.issues          enable row level security;
alter table public.issue_events    enable row level security;
alter table public.audit_logs      enable row level security;

-- reference data: readable by any active staff member, writable by admins
drop policy if exists zones_read on public.zones;
create policy zones_read  on public.zones for select to authenticated using (public.current_staff_id() is not null);
drop policy if exists zones_admin on public.zones;
create policy zones_admin on public.zones for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists eqt_read on public.equipment_types;
create policy eqt_read  on public.equipment_types for select to authenticated using (public.current_staff_id() is not null);
drop policy if exists eqt_admin on public.equipment_types;
create policy eqt_admin on public.equipment_types for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_read on public.app_settings;
create policy settings_read  on public.app_settings for select to authenticated using (public.current_staff_id() is not null);
drop policy if exists settings_admin on public.app_settings;
create policy settings_admin on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- login screen texts are public (no other data is)
create or replace function public.public_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.app_settings
  where key in ('app_name_ar','app_name_en','login_message_ar','login_message_en','session_idle_minutes')
$$;

-- staff: admins see all, a technician sees only their own row
drop policy if exists staff_self on public.staff;
create policy staff_self  on public.staff for select to authenticated using (auth_user_id = auth.uid() or public.is_admin());
drop policy if exists staff_admin_ins on public.staff;
create policy staff_admin_ins on public.staff for insert to authenticated with check (public.is_admin());
drop policy if exists staff_admin_upd on public.staff;
create policy staff_admin_upd on public.staff for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- stores: admins all; technicians only stores assigned to them
drop policy if exists stores_read on public.stores;
create policy stores_read on public.stores for select to authenticated
  using (public.is_admin() or assigned_tech_id = public.current_staff_id());
drop policy if exists stores_admin_ins on public.stores;
create policy stores_admin_ins on public.stores for insert to authenticated with check (public.is_admin());
drop policy if exists stores_admin_upd on public.stores;
create policy stores_admin_upd on public.stores for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists se_read on public.store_equipment;
create policy se_read on public.store_equipment for select to authenticated
  using (public.is_admin() or exists (select 1 from public.stores s where s.store_code = store_equipment.store_code and s.assigned_tech_id = public.current_staff_id()));
drop policy if exists se_admin on public.store_equipment;
create policy se_admin on public.store_equipment for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- inspections: read own / all for admin; writes only through submit_inspection(); never updated or deleted
drop policy if exists ins_read on public.inspections;
create policy ins_read on public.inspections for select to authenticated
  using (public.is_admin() or tech_id = public.current_staff_id());

-- issues: admin all reads; technician reads issues of their stores; changes only through update_issue()
drop policy if exists iss_read on public.issues;
create policy iss_read on public.issues for select to authenticated
  using (public.is_admin() or exists (select 1 from public.stores s where s.store_code = issues.store_code and s.assigned_tech_id = public.current_staff_id()));
drop policy if exists issev_read on public.issue_events;
create policy issev_read on public.issue_events for select to authenticated using (public.is_admin());

drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs for select to authenticated using (public.is_admin());

-- table privileges: anon gets nothing; no direct writes to history tables
revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.inspections, public.issues, public.issue_events, public.audit_logs from authenticated;
revoke delete on public.staff, public.stores, public.store_equipment, public.equipment_types from authenticated;
revoke all on all functions in schema public from anon, public;
grant execute on function public.public_settings() to anon, authenticated;
grant execute on function public.current_staff_id(), public.is_admin(), public.setting(text, jsonb),
  public.cairo_today(), public.week_start_of(date) to authenticated;

create or replace function public.ar_value(v text) returns text language sql immutable as $$
  select case v when 'good' then 'سليم' when 'damaged' then 'تالف' when 'missing' then 'مفقود' when 'stiff' then 'متصلب / عالق'
    when 'broken' then 'مكسور / متشقق' when 'low' then 'منخفضة' when 'failed' then 'معطلة' when 'dirty' then 'تالفة / متسخة'
    when 'working' then 'تعمل' when 'faulty' then 'خلل' when 'ok' then 'يعمل' when 'fault' then 'يوجد عطل'
    when 'running' then 'تعمل' when 'not_running' then 'لا تعمل' when 'tested' then 'تم التجربة' when 'not_tested' then 'لم يتم التجربة'
    else coalesce(v,'—') end
$$;

-- ═══════════════════════════════════════════════════════════════════
-- submit_inspection — the only way to create an inspection.
-- Quantities come from the server-side base, never from the client.
-- ═══════════════════════════════════════════════════════════════════
create or replace function public.submit_inspection(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me public.staff; st public.stores; base public.store_equipment; z public.zones;
  v_client uuid := (p->>'client_id')::uuid;
  v_today date := public.cairo_today();
  v_week  date := public.week_start_of(public.cairo_today());
  v_existing public.inspections;
  v_override boolean := coalesce((p->>'override')::boolean, false);
  act jsonb; r public.inspections; v_issues jsonb := '[]'::jsonb;
  req_rmk boolean := coalesce((public.setting('require_remarks_on_issue','false'::jsonb))::text::boolean, false);
  seq int := 0; it jsonb; eqc text; g int; d int; m int; q int;
begin
  select * into me from public.staff where auth_user_id = auth.uid() and active;
  if me.id is null then raise exception 'NOT_AUTHORIZED'; end if;
  if v_client is null then raise exception 'CLIENT_ID_REQUIRED'; end if;

  -- idempotent retry (offline sync)
  select * into v_existing from public.inspections where client_id = v_client;
  if v_existing.id is not null then
    if v_existing.tech_id <> me.id and not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
    return jsonb_build_object('id', v_existing.id, 'code', v_existing.inspection_code, 'replayed', true, 'overall', v_existing.overall_status);
  end if;

  select * into st from public.stores where store_code = p->>'store_code';
  if st.store_code is null or not st.active then raise exception 'STORE_NOT_FOUND'; end if;
  if me.role <> 'admin' and st.assigned_tech_id is distinct from me.id then raise exception 'STORE_NOT_ASSIGNED'; end if;

  select * into base from public.store_equipment where store_code = st.store_code;
  if base.store_code is null then raise exception 'NO_BASE_QUANTITIES'; end if;
  select * into z from public.zones where id = st.zone_id;

  if exists (select 1 from public.inspections where store_code = st.store_code and week_start = v_week) then
    if not v_override then raise exception 'DUPLICATE_WEEK'; end if;
    if me.role <> 'admin' then raise exception 'OVERRIDE_ADMIN_ONLY'; end if;
    if length(trim(coalesce(p->>'override_reason',''))) = 0 then raise exception 'OVERRIDE_REASON_REQUIRED'; end if;
  else
    v_override := false;
  end if;

  select coalesce(jsonb_object_agg(code, active), '{}'::jsonb) into act from public.equipment_types;

  -- quantity checks for counted equipment
  foreach eqc in array array['p6','co2','fs'] loop
    q := case eqc when 'p6' then base.p6_qty when 'co2' then base.co2_qty else base.fs_qty end;
    if coalesce((act->>eqc)::boolean, true) then
      g := coalesce((p->eqc->>'good')::int, -1); d := coalesce((p->eqc->>'dmg')::int, -1); m := coalesce((p->eqc->>'miss')::int, -1);
      if least(g,d,m) < 0 then raise exception 'INVALID_COUNT:%', eqc; end if;
      if g + d + m <> q then raise exception 'COUNT_MISMATCH:%:%', eqc, q; end if;
    end if;
  end loop;

  r.p6_qty:=0; r.p6_good:=0; r.p6_dmg:=0; r.p6_miss:=0; r.co2_qty:=0; r.co2_good:=0; r.co2_dmg:=0; r.co2_miss:=0;
  r.fs_qty:=0; r.fs_good:=0; r.fs_dmg:=0; r.fs_miss:=0; r.hc_total:=0; r.hc_ok:=0;
  r.p6_status:='na'; r.co2_status:='na'; r.fs_status:='na'; r.hc_status:='na'; r.al_status:='na'; r.fp_status:='na';
  r.id := gen_random_uuid(); r.client_id := v_client; r.store_code := st.store_code; r.tech_id := me.id;
  r.week_start := v_week; r.inspection_date := v_today; r.submitted_at := now();
  r.store_name_snapshot := st.name; r.zone_snapshot := coalesce(z.code,''); r.tech_name_snapshot := me.full_name;
  r.inspection_code := 'INS-' || to_char(v_today,'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  if coalesce((act->>'p6')::boolean,true) then
    r.p6_qty := base.p6_qty; r.p6_good := (p->'p6'->>'good')::int; r.p6_dmg := (p->'p6'->>'dmg')::int; r.p6_miss := (p->'p6'->>'miss')::int;
    r.p6_status := case when r.p6_dmg + r.p6_miss > 0 then 'issue' else 'ok' end; r.p6_rmk := nullif(trim(p->'p6'->>'rmk'),'');
  end if;
  if coalesce((act->>'co2')::boolean,true) then
    r.co2_qty := base.co2_qty; r.co2_good := (p->'co2'->>'good')::int; r.co2_dmg := (p->'co2'->>'dmg')::int; r.co2_miss := (p->'co2'->>'miss')::int;
    r.co2_status := case when r.co2_dmg + r.co2_miss > 0 then 'issue' else 'ok' end; r.co2_rmk := nullif(trim(p->'co2'->>'rmk'),'');
  end if;
  if coalesce((act->>'fs')::boolean,true) then
    r.fs_qty := base.fs_qty; r.fs_good := (p->'fs'->>'good')::int; r.fs_dmg := (p->'fs'->>'dmg')::int; r.fs_miss := (p->'fs'->>'miss')::int;
    r.fs_status := case when r.fs_dmg + r.fs_miss > 0 then 'issue' else 'ok' end; r.fs_rmk := nullif(trim(p->'fs'->>'rmk'),'');
  end if;
  if coalesce((act->>'hc')::boolean,true) then
    r.hc_total := base.hc_total; r.hc_ok := coalesce((p->'hc'->>'ok')::int, -1);
    if r.hc_ok < 0 or r.hc_ok > r.hc_total then raise exception 'INVALID_COUNT:hc'; end if;
    r.hc_hose := p->'hc'->>'hose'; r.hc_valve := p->'hc'->>'valve'; r.hc_glass := p->'hc'->>'glass';
    if r.hc_total > 0 and (r.hc_hose is null or r.hc_valve is null or r.hc_glass is null) then raise exception 'MISSING_FIELD:hc'; end if;
    r.hc_status := case when r.hc_total = 0 then 'na'
                        when r.hc_ok < r.hc_total or r.hc_hose <> 'good' or r.hc_valve <> 'good' or r.hc_glass <> 'good' then 'issue' else 'ok' end;
    r.hc_rmk := nullif(trim(p->'hc'->>'rmk'),'');
  end if;
  if coalesce((act->>'al')::boolean,true) then
    r.al_system := p->'al'->>'system'; r.al_battery := p->'al'->>'battery'; r.al_detectors := p->'al'->>'detectors';
    r.al_mcp := p->'al'->>'mcp'; r.al_sounders := p->'al'->>'sounders';
    if r.al_system is null or r.al_battery is null or r.al_detectors is null or r.al_mcp is null or r.al_sounders is null then raise exception 'MISSING_FIELD:al'; end if;
    r.al_status := case when r.al_system = 'fault' or r.al_battery <> 'good' or r.al_detectors <> 'good' or r.al_mcp <> 'good' or r.al_sounders <> 'working' then 'issue' else 'ok' end;
    r.al_rmk := nullif(trim(p->'al'->>'rmk'),'');
  end if;
  if coalesce((act->>'fp')::boolean,true) then
    r.fp_available := coalesce((p->'fp'->>'available')::boolean, false);
    if r.fp_available then
      r.fp_running := p->'fp'->>'running'; r.fp_tested := p->'fp'->>'tested';
      if r.fp_running not in ('running','not_running') or r.fp_tested not in ('tested','not_tested') then raise exception 'MISSING_FIELD:fp'; end if;
      r.fp_status := case when r.fp_running = 'not_running' or r.fp_tested = 'not_tested' then 'issue' else 'ok' end;
    else
      r.fp_running := 'na'; r.fp_tested := 'na'; r.fp_status := 'na';
    end if;
    r.fp_rmk := nullif(trim(p->'fp'->>'rmk'),'');
  end if;

  r.general_remarks := nullif(trim(p->>'general_remarks'),'');
  r.overall_status := case when 'issue' in (r.p6_status, r.co2_status, r.fs_status, r.hc_status, r.al_status, r.fp_status) then 'warn' else 'ok' end;
  r.duplicate_override := v_override; r.override_reason := case when v_override then trim(p->>'override_reason') end;
  r.created_by := auth.uid();

  if req_rmk then
    if (r.p6_status='issue' and r.p6_rmk is null) or (r.co2_status='issue' and r.co2_rmk is null) or (r.fs_status='issue' and r.fs_rmk is null)
       or (r.hc_status='issue' and r.hc_rmk is null) or (r.al_status='issue' and r.al_rmk is null) or (r.fp_status='issue' and r.fp_rmk is null) then
      raise exception 'REMARKS_REQUIRED';
    end if;
  end if;

  insert into public.inspections select r.*;

  -- issues: same rules as the pilot, generated server-side
  for it in
    select x from jsonb_array_elements(jsonb_build_array(
      case when r.p6_status='issue' then jsonb_build_object('eq','p6','prio', case when r.p6_miss>0 then 'high' else 'medium' end,
        'txt', concat_ws(' · ', nullif(r.p6_dmg,0)||' تالفة', nullif(r.p6_miss,0)||' مفقودة', 'من إجمالي '||r.p6_qty, r.p6_rmk)) end,
      case when r.co2_status='issue' then jsonb_build_object('eq','co2','prio','medium',
        'txt', concat_ws(' · ', nullif(r.co2_dmg,0)||' تالفة', nullif(r.co2_miss,0)||' مفقودة', 'من إجمالي '||r.co2_qty, r.co2_rmk)) end,
      case when r.fs_status='issue' then jsonb_build_object('eq','fs','prio','medium',
        'txt', concat_ws(' · ', nullif(r.fs_dmg,0)||' تالفة', nullif(r.fs_miss,0)||' مفقودة', 'من إجمالي '||r.fs_qty, r.fs_rmk)) end,
      case when r.hc_status='issue' then jsonb_build_object('eq','hc','prio','medium',
        'txt', concat_ws(' · ', 'سليمة تماماً '||r.hc_ok||' من '||r.hc_total, 'الخرطوم: '||public.ar_value(r.hc_hose), 'الصمام: '||public.ar_value(r.hc_valve), 'الزجاج: '||public.ar_value(r.hc_glass), r.hc_rmk)) end,
      case when r.al_status='issue' then jsonb_build_object('eq','al','prio', case when r.al_system='fault' then 'critical' else 'high' end,
        'txt', concat_ws(' · ', 'النظام: '||public.ar_value(r.al_system), 'البطارية: '||public.ar_value(r.al_battery), 'الكواشف: '||public.ar_value(r.al_detectors), 'MCP: '||public.ar_value(r.al_mcp), 'الإنذار الصوتي: '||public.ar_value(r.al_sounders), r.al_rmk)) end,
      case when r.fp_status='issue' then jsonb_build_object('eq','fp','prio','high',
        'txt', concat_ws(' · ', 'التشغيل: '||public.ar_value(r.fp_running), 'التجربة: '||public.ar_value(r.fp_tested), r.fp_rmk)) end
    )) x where x <> 'null'::jsonb
  loop
    seq := seq + 1;
    insert into public.issues(issue_code, inspection_id, store_code, equipment, description, priority, created_by)
    values (r.inspection_code || '-' || lpad(seq::text, 2, '0'), r.id, r.store_code, it->>'eq', it->>'txt',
            (it->>'prio')::public.issue_priority, me.id);
    v_issues := v_issues || jsonb_build_object('equipment', it->>'eq', 'priority', it->>'prio');
  end loop;

  return jsonb_build_object('id', r.id, 'code', r.inspection_code, 'overall', r.overall_status, 'issues', v_issues, 'replayed', false);
end $$;
grant execute on function public.submit_inspection(jsonb) to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- update_issue — admin-only workflow with history
-- ═══════════════════════════════════════════════════════════════════
create or replace function public.update_issue(p_issue uuid, p_status public.issue_status, p_assigned uuid default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare i public.issues; me uuid := public.current_staff_id();
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  select * into i from public.issues where id = p_issue for update;
  if i.id is null then raise exception 'ISSUE_NOT_FOUND'; end if;
  if i.status in ('resolved','closed') and p_status not in ('closed','open') then raise exception 'INVALID_TRANSITION'; end if;
  if p_status = 'assigned' and p_assigned is null and i.assigned_to is null then raise exception 'ASSIGNEE_REQUIRED'; end if;
  if p_status in ('resolved','closed') and length(trim(coalesce(p_note, i.resolution_notes, ''))) = 0 then raise exception 'RESOLUTION_NOTES_REQUIRED'; end if;

  update public.issues set
    status = p_status,
    assigned_to = coalesce(p_assigned, assigned_to),
    resolved_at = case when p_status in ('resolved','closed') then coalesce(resolved_at, now()) when p_status = 'open' then null else resolved_at end,
    resolved_by = case when p_status in ('resolved','closed') then coalesce(resolved_by, me) when p_status = 'open' then null else resolved_by end,
    resolution_notes = case when p_status in ('resolved','closed') then coalesce(nullif(trim(p_note),''), resolution_notes) else resolution_notes end
  where id = p_issue;
  insert into public.issue_events(issue_id, from_status, to_status, note, actor_id) values (p_issue, i.status, p_status, nullif(trim(p_note),''), me);
end $$;
grant execute on function public.update_issue(uuid, public.issue_status, uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- Store status + dashboard (computed from real rows; RLS-aware)
-- ═══════════════════════════════════════════════════════════════════
create or replace view public.v_store_status with (security_invoker = true) as
with last as (
  select distinct on (store_code) store_code, inspection_date, week_start, overall_status, inspection_code
  from public.inspections order by store_code, inspection_date desc, submitted_at desc
)
select s.store_code, s.name, s.zone_id, s.assigned_tech_id, s.active, s.flagged,
       l.inspection_date as last_date, l.overall_status as last_overall, l.inspection_code as last_code,
       (se.store_code is not null) as has_base,
       case
         when l.week_start = public.week_start_of(public.cairo_today()) then case when l.overall_status = 'ok' then 'ok' else 'issues' end
         when l.inspection_date is null then 'never'
         when public.cairo_today() - l.inspection_date > coalesce((public.setting('overdue_days','7'::jsonb))::text::int, 7) then 'overdue'
         else 'pending'
       end as status,
       (select count(*) from public.issues i where i.store_code = s.store_code and i.status not in ('resolved','closed')) as open_issues
from public.stores s
left join last l on l.store_code = s.store_code
left join public.store_equipment se on se.store_code = s.store_code;
grant select on public.v_store_status to authenticated;

create or replace function public.dashboard_summary(p_zone uuid default null) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare res jsonb; wk date := public.week_start_of(public.cairo_today());
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  with st as (select * from public.v_store_status where active and (p_zone is null or zone_id = p_zone)),
  iss as (select i.* from public.issues i join public.stores s using (store_code) where p_zone is null or s.zone_id = p_zone)
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
grant execute on function public.dashboard_summary(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- bootstrap_admin — run ONCE from the SQL editor after creating the first
-- Auth user in the dashboard. Not callable from the app.
-- ═══════════════════════════════════════════════════════════════════
create or replace function public.bootstrap_admin(p_email text, p_legacy_code text default 'ADMIN01')
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if exists (select 1 from public.staff where role = 'admin' and auth_user_id is not null) then
    raise exception 'ALREADY_BOOTSTRAPPED';
  end if;
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then raise exception 'AUTH_USER_NOT_FOUND: create it first in Authentication > Users'; end if;
  update public.staff set auth_user_id = uid, role = 'admin', active = true,
         username = coalesce(username, split_part(lower(p_email), '@', 1))
   where legacy_code = p_legacy_code;
  if not found then raise exception 'STAFF_NOT_FOUND'; end if;
  return 'OK — admin linked to ' || p_email;
end $$;
revoke all on function public.bootstrap_admin(text, text) from public, anon, authenticated;

-- ── final function privileges (Supabase grants EXECUTE to anon by default; take it back) ──
revoke execute on all functions in schema public from public, anon;
grant execute on function public.public_settings() to anon, authenticated;
grant execute on function public.current_staff_id(), public.is_admin(), public.setting(text, jsonb), public.cairo_today(),
  public.week_start_of(date), public.ar_value(text), public.submit_inspection(jsonb),
  public.update_issue(uuid, public.issue_status, uuid, text), public.dashboard_summary(uuid) to authenticated;
revoke execute on function public.bootstrap_admin(text, text) from authenticated;
