-- ONE-FILE SETUP for the Supabase SQL Editor (alternative to the 'Deploy database & functions' GitHub Action).
-- Safe to run more than once. Generated from supabase/migrations — do not edit by hand.

-- ===== supabase/migrations/20261120000001_schema.sql =====
-- ═══════════════════════════════════════════════════════════════════
-- Fire Safety Management — schema
-- Week = Sunday → Saturday (Africa/Cairo). Week is identified by week_start (a Sunday).
-- ═══════════════════════════════════════════════════════════════════
create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role       as enum ('admin','technician');
  create type public.issue_status   as enum ('open','assigned','in_progress','resolved','closed');
  create type public.issue_priority as enum ('critical','high','medium','low');
exception when duplicate_object then null; end $$;

-- ── helpers ──────────────────────────────────────────────────────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

create or replace function public.cairo_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Cairo')::date $$;

create or replace function public.week_start_of(d date) returns date
language sql immutable as $$ select d - extract(dow from d)::int $$;   -- dow: Sunday = 0

-- ── zones ────────────────────────────────────────────────────────────
create table if not exists public.zones (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (length(trim(code)) between 1 and 40),
  name_ar    text not null check (length(trim(name_ar)) between 1 and 80),
  name_en    text not null check (length(trim(name_en)) between 1 and 80),
  sort       int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── staff (people; a login is linked later through auth_user_id) ─────
create table if not exists public.staff (
  id           uuid primary key default gen_random_uuid(),
  legacy_code  text unique,
  full_name    text not null check (length(trim(full_name)) between 1 and 80),
  username     text unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  role         public.app_role not null default 'technician',
  zone_id      uuid references public.zones(id) on delete set null,
  phone        text check (phone is null or length(phone) <= 30),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── stores (store_code is the stable id and never changes on rename) ─
create table if not exists public.stores (
  store_code       text primary key check (store_code ~ '^[A-Za-z0-9_-]{1,30}$'),
  name             text not null check (length(trim(name)) between 1 and 120),
  zone_id          uuid not null references public.zones(id),
  assigned_tech_id uuid references public.staff(id) on delete set null,
  active           boolean not null default true,
  flagged          boolean not null default false,
  notes            text check (notes is null or length(notes) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists stores_tech_idx on public.stores(assigned_tech_id);
create index if not exists stores_zone_idx on public.stores(zone_id);

-- ── equipment types (labels & on/off editable from the UI) ───────────
create table if not exists public.equipment_types (
  code         text primary key check (code in ('p6','co2','fs','hc','al','fp')),
  name_ar      text not null,
  name_en      text not null,
  has_quantity boolean not null,
  active       boolean not null default true,
  sort         int not null default 0,
  updated_at   timestamptz not null default now()
);

-- ── permanent base quantities per store (admin only) ─────────────────
create table if not exists public.store_equipment (
  store_code text primary key references public.stores(store_code) on update cascade on delete cascade,
  p6_qty     int not null default 0 check (p6_qty   between 0 and 9999),
  co2_qty    int not null default 0 check (co2_qty  between 0 and 9999),
  fs_qty     int not null default 0 check (fs_qty   between 0 and 9999),
  hc_total   int not null default 0 check (hc_total between 0 and 9999),
  updated_by uuid references public.staff(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ── settings (allow-listed keys only) ────────────────────────────────
create table if not exists public.app_settings (
  key        text primary key check (key in (
               'app_name_ar','app_name_en','login_message_ar','login_message_en',
               'overdue_days','require_remarks_on_issue','session_idle_minutes','week_deadline_dow')),
  value      jsonb not null,
  updated_by uuid references public.staff(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ── inspections (immutable after insert) ─────────────────────────────
create table if not exists public.inspections (
  id                 uuid primary key default gen_random_uuid(),
  inspection_code    text not null unique default ('INS-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  client_id          uuid not null unique,
  store_code         text not null references public.stores(store_code) on update cascade,
  tech_id            uuid not null references public.staff(id),
  week_start         date not null check (extract(dow from week_start) = 0),
  inspection_date    date not null,
  submitted_at       timestamptz not null default now(),
  store_name_snapshot text not null,
  zone_snapshot       text not null,
  tech_name_snapshot  text not null,

  p6_qty int not null default 0, p6_good int not null default 0, p6_dmg int not null default 0, p6_miss int not null default 0,
  p6_status text not null default 'na' check (p6_status in ('ok','issue','na')), p6_rmk text,
  co2_qty int not null default 0, co2_good int not null default 0, co2_dmg int not null default 0, co2_miss int not null default 0,
  co2_status text not null default 'na' check (co2_status in ('ok','issue','na')), co2_rmk text,
  fs_qty int not null default 0, fs_good int not null default 0, fs_dmg int not null default 0, fs_miss int not null default 0,
  fs_status text not null default 'na' check (fs_status in ('ok','issue','na')), fs_rmk text,

  hc_total int not null default 0, hc_ok int not null default 0,
  hc_hose  text check (hc_hose  in ('good','damaged','missing')),
  hc_valve text check (hc_valve in ('good','stiff','damaged')),
  hc_glass text check (hc_glass in ('good','broken','missing')),
  hc_status text not null default 'na' check (hc_status in ('ok','issue','na')), hc_rmk text,

  al_system    text check (al_system    in ('ok','fault')),
  al_battery   text check (al_battery   in ('good','low','failed')),
  al_detectors text check (al_detectors in ('good','dirty','missing')),
  al_mcp       text check (al_mcp       in ('good','damaged','missing')),
  al_sounders  text check (al_sounders  in ('working','faulty','missing')),
  al_status text not null default 'na' check (al_status in ('ok','issue','na')), al_rmk text,

  fp_available boolean,
  fp_running   text check (fp_running in ('running','not_running','na')),
  fp_tested    text check (fp_tested  in ('tested','not_tested','na')),
  fp_status text not null default 'na' check (fp_status in ('ok','issue','na')), fp_rmk text,

  overall_status     text not null check (overall_status in ('ok','warn')),
  general_remarks    text,
  duplicate_override boolean not null default false,
  override_reason    text,
  created_by         uuid default auth.uid(),

  check (least(p6_qty,p6_good,p6_dmg,p6_miss,co2_qty,co2_good,co2_dmg,co2_miss,fs_qty,fs_good,fs_dmg,fs_miss,hc_total,hc_ok) >= 0),
  check (p6_good  + p6_dmg  + p6_miss  = p6_qty),
  check (co2_good + co2_dmg + co2_miss = co2_qty),
  check (fs_good  + fs_dmg  + fs_miss  = fs_qty),
  check (hc_ok <= hc_total),
  check (not duplicate_override or length(trim(coalesce(override_reason,''))) > 0),
  check (coalesce(length(general_remarks),0) <= 2000 and coalesce(length(p6_rmk),0) <= 1000 and coalesce(length(co2_rmk),0) <= 1000
     and coalesce(length(fs_rmk),0) <= 1000 and coalesce(length(hc_rmk),0) <= 1000 and coalesce(length(al_rmk),0) <= 1000
     and coalesce(length(fp_rmk),0) <= 1000)
);
create unique index if not exists inspections_one_per_week on public.inspections(store_code, week_start) where not duplicate_override;
create index if not exists inspections_store_idx on public.inspections(store_code, inspection_date desc);
create index if not exists inspections_tech_idx  on public.inspections(tech_id, inspection_date desc);
create index if not exists inspections_week_idx  on public.inspections(week_start);

-- ── issues ───────────────────────────────────────────────────────────
create table if not exists public.issues (
  id               uuid primary key default gen_random_uuid(),
  issue_code       text not null unique,
  inspection_id    uuid references public.inspections(id),
  store_code       text not null references public.stores(store_code) on update cascade,
  equipment        text not null references public.equipment_types(code),
  description      text not null check (length(description) <= 2000),
  priority         public.issue_priority not null,
  status           public.issue_status not null default 'open',
  assigned_to      uuid references public.staff(id) on delete set null,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.staff(id) on delete set null,
  updated_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid references public.staff(id) on delete set null,
  resolution_notes text check (resolution_notes is null or length(resolution_notes) <= 2000),
  check (status not in ('resolved','closed') or (resolved_at is not null and length(trim(coalesce(resolution_notes,''))) > 0))
);
create index if not exists issues_status_idx on public.issues(status, priority);
create index if not exists issues_store_idx  on public.issues(store_code);

create table if not exists public.issue_events (
  id          bigserial primary key,
  issue_id    uuid not null references public.issues(id) on delete cascade,
  from_status public.issue_status,
  to_status   public.issue_status not null,
  note        text,
  actor_id    uuid references public.staff(id) on delete set null,
  at          timestamptz not null default now()
);

-- ── audit log (insert-only, written by triggers / definer functions) ─
create table if not exists public.audit_logs (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  actor_auth uuid,
  actor_staff uuid,
  action    text not null,
  entity    text not null,
  entity_id text,
  detail    jsonb
);
create index if not exists audit_at_idx on public.audit_logs(at desc);

-- updated_at triggers
do $$ declare t text; begin
  foreach t in array array['zones','staff','stores','store_equipment','app_settings','equipment_types','issues'] loop
    execute format('drop trigger if exists trg_touch on public.%I', t);
    execute format('create trigger trg_touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ===== supabase/migrations/20261120000002_security_and_rpc.sql =====
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

-- ===== supabase/migrations/20261120000003_master_data.sql =====
-- Generated by scripts/build_master_seed.py — master data only, no credentials.
begin;
insert into public.zones(code,name_ar,name_en,sort) values ('Zone 1','المنطقة 1','Zone 1',1) on conflict (code) do nothing;
insert into public.zones(code,name_ar,name_en,sort) values ('Zone 2','المنطقة 2','Zone 2',2) on conflict (code) do nothing;
insert into public.zones(code,name_ar,name_en,sort) values ('Zone 3','المنطقة 3','Zone 3',3) on conflict (code) do nothing;
insert into public.zones(code,name_ar,name_en,sort) values ('Zone 4','المنطقة 4','Zone 4',4) on conflict (code) do nothing;
insert into public.staff(legacy_code,full_name,username,role,zone_id,active) values ('TECH001','Bassem','tech001','technician',(select id from public.zones where code='Zone 1'),true) on conflict (legacy_code) do nothing;
insert into public.staff(legacy_code,full_name,username,role,zone_id,active) values ('TECH002','Ayman','tech002','technician',(select id from public.zones where code='Zone 2'),true) on conflict (legacy_code) do nothing;
insert into public.staff(legacy_code,full_name,username,role,zone_id,active) values ('TECH003','Tarek','tech003','technician',(select id from public.zones where code='Zone 3'),true) on conflict (legacy_code) do nothing;
insert into public.staff(legacy_code,full_name,username,role,zone_id,active) values ('TECH004','Samir','tech004','technician',(select id from public.zones where code='Zone 4'),true) on conflict (legacy_code) do nothing;
insert into public.staff(legacy_code,full_name,username,role,zone_id,active) values ('ADMIN01','Admin-(ENG Anwer)','admin01','admin',null,true) on conflict (legacy_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS2','Dokki',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS5','Lebanon Square',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS7','Agouza',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS11','Haram Tersa',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS12','Icon Mall',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS18','Hadayek El Ahram',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS22','Sheikh Zayed',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS36','Palm Hills',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS42','Haram 2',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS44','October Wahat',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS47','Seoudi Bright Star',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS53','Sheikh Zayed 2',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS54','Faisal Maryoteya',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS58','October Festival City',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS66','EG Palm Hills (2)',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,true) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS76','EG October Beta Gardens',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,true) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS85','Imbaba',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,true) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS82','West Somid',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,true) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS77','EG Cargo Mall',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,true) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS86','Giza 4',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,true) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS86B','EG Haram (2)',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,true) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS89','EG October Mountain View',(select id from public.zones where code='Zone 1'),(select id from public.staff where legacy_code='TECH001'),true,true) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS1','Maadi',(select id from public.zones where code='Zone 2'),(select id from public.staff where legacy_code='TECH002'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS4','Zahraa El Maadi',(select id from public.zones where code='Zone 2'),(select id from public.staff where legacy_code='TECH002'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS6','Mokattam',(select id from public.zones where code='Zone 2'),(select id from public.staff where legacy_code='TECH002'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS9','Maadi Cornish',(select id from public.zones where code='Zone 2'),(select id from public.staff where legacy_code='TECH002'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS13','Al Manial',(select id from public.zones where code='Zone 2'),(select id from public.staff where legacy_code='TECH002'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS14','Helwan',(select id from public.zones where code='Zone 2'),(select id from public.staff where legacy_code='TECH002'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS15','Sayeda Zeinab',(select id from public.zones where code='Zone 2'),(select id from public.staff where legacy_code='TECH002'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS16','El Daher',(select id from public.zones where code='Zone 2'),(select id from public.staff where legacy_code='TECH002'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS21','Hadayek El Kouba',(select id from public.zones where code='Zone 2'),(select id from public.staff where legacy_code='TECH002'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS45','Mokattam II',(select id from public.zones where code='Zone 2'),(select id from public.staff where legacy_code='TECH002'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS49','Zahraa El Maadi 2',(select id from public.zones where code='Zone 2'),(select id from public.staff where legacy_code='TECH002'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS71','EG Mokattam (3)',(select id from public.zones where code='Zone 2'),(select id from public.staff where legacy_code='TECH002'),true,true) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS81','Maadi 3 Nasr Street',(select id from public.zones where code='Zone 2'),(select id from public.staff where legacy_code='TECH002'),true,true) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS3','Rehab',(select id from public.zones where code='Zone 3'),(select id from public.staff where legacy_code='TECH003'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS10','Heliopolis',(select id from public.zones where code='Zone 3'),(select id from public.staff where legacy_code='TECH003'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS23','Madinaty 1',(select id from public.zones where code='Zone 3'),(select id from public.staff where legacy_code='TECH003'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS28','Shobra',(select id from public.zones where code='Zone 3'),(select id from public.staff where legacy_code='TECH003'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS29','El Shorouk',(select id from public.zones where code='Zone 3'),(select id from public.staff where legacy_code='TECH003'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS30','El Obour',(select id from public.zones where code='Zone 3'),(select id from public.staff where legacy_code='TECH003'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS31','Ain Shams',(select id from public.zones where code='Zone 3'),(select id from public.staff where legacy_code='TECH003'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS39','Madinaty 2',(select id from public.zones where code='Zone 3'),(select id from public.staff where legacy_code='TECH003'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS50','Rehab 2',(select id from public.zones where code='Zone 3'),(select id from public.staff where legacy_code='TECH003'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS51','El Shorouk 2',(select id from public.zones where code='Zone 3'),(select id from public.staff where legacy_code='TECH003'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS52','Heliopolis 2',(select id from public.zones where code='Zone 3'),(select id from public.staff where legacy_code='TECH003'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS57','El Obour 2',(select id from public.zones where code='Zone 3'),(select id from public.staff where legacy_code='TECH003'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS74','EG 10th of Ramadan',(select id from public.zones where code='Zone 3'),(select id from public.staff where legacy_code='TECH003'),true,true) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS_SHOROUK3','Sherouk 3 Chill Out',(select id from public.zones where code='Zone 3'),(select id from public.staff where legacy_code='TECH003'),true,true) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS87','EG Obour (3)',(select id from public.zones where code='Zone 3'),(select id from public.staff where legacy_code='TECH003'),true,true) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS8','Nasr City 1 (Wafa & Amal)',(select id from public.zones where code='Zone 4'),(select id from public.staff where legacy_code='TECH004'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS17','City Stars',(select id from public.zones where code='Zone 4'),(select id from public.staff where legacy_code='TECH004'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS19','First Mall',(select id from public.zones where code='Zone 4'),(select id from public.staff where legacy_code='TECH004'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS20','Fount Mall',(select id from public.zones where code='Zone 4'),(select id from public.staff where legacy_code='TECH004'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS37','Tagamoa 1',(select id from public.zones where code='Zone 4'),(select id from public.staff where legacy_code='TECH004'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS40','Nasr City 2',(select id from public.zones where code='Zone 4'),(select id from public.staff where legacy_code='TECH004'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS43','Tagamoa 5 Mahkama',(select id from public.zones where code='Zone 4'),(select id from public.staff where legacy_code='TECH004'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS46','Golden Square',(select id from public.zones where code='Zone 4'),(select id from public.staff where legacy_code='TECH004'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS55','Banafseg 8',(select id from public.zones where code='Zone 4'),(select id from public.staff where legacy_code='TECH004'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS56','Tagamoa 5 Rock Vera',(select id from public.zones where code='Zone 4'),(select id from public.staff where legacy_code='TECH004'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS59','Nasr City International Park',(select id from public.zones where code='Zone 4'),(select id from public.staff where legacy_code='TECH004'),true,false) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS64','EG Tagamoa 5 Spot Mall',(select id from public.zones where code='Zone 4'),(select id from public.staff where legacy_code='TECH004'),true,true) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS63','EG Nasr City (4)',(select id from public.zones where code='Zone 4'),(select id from public.staff where legacy_code='TECH004'),true,true) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS_CITYSTARS2','City Stars 2 Rabwa Mall',(select id from public.zones where code='Zone 4'),(select id from public.staff where legacy_code='TECH004'),true,true) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS_TAGAMOA10','Tagamoa 10 El Lotus 4',(select id from public.zones where code='Zone 4'),(select id from public.staff where legacy_code='TECH004'),true,true) on conflict (store_code) do nothing;
insert into public.stores(store_code,name,zone_id,assigned_tech_id,active,flagged) values ('DS72','City Stars 2 Rabwa Mall (DS72)',(select id from public.zones where code='Zone 4'),(select id from public.staff where legacy_code='TECH004'),true,true) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS2',6,0,1,2,'2026-10-25T10:19:35.663Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS5',6,0,1,2,'2026-10-25T10:19:36.370Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS30',6,0,1,2,'2026-10-22T13:16:58.043Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS57',8,0,1,2,'2026-10-22T13:16:54.628Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS29',5,1,1,2,'2026-10-22T13:16:58.939Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS51',6,1,1,2,'2026-10-22T13:16:55.534Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS28',5,2,1,2,'2026-10-22T13:28:53.378Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS31',5,0,0,2,'2026-10-22T13:16:57.119Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS3',8,1,2,2,'2026-10-22T13:17:02.344Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS50',5,0,1,2,'2026-10-22T13:16:56.466Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS1',5,2,1,2,'2026-10-25T10:31:32.771Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS4',6,1,1,2,'2026-10-25T10:31:31.209Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS49',6,0,2,2,'2026-10-25T10:20:45.014Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS16',6,1,1,2,'2026-10-25T10:23:39.978Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS9',5,2,1,2,'2026-10-25T10:31:33.441Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS6',5,1,1,2,'2026-10-25T10:31:31.833Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS15',5,1,1,2,'2026-10-25T10:20:47.665Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS13',5,1,1,2,'2026-10-25T10:31:33.976Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS7',4,1,0,2,'2026-10-25T10:19:36.857Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS8',5,0,1,2,'2026-10-22T13:07:31.311Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS17',5,1,1,2,'2026-10-22T13:07:49.128Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS19',5,1,1,2,'2026-10-22T13:08:57.594Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS20',5,1,1,2,'2026-10-22T13:09:23.322Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS43',5,1,1,2,'2026-10-22T13:10:15.375Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS55',6,1,1,2,'2026-10-22T13:11:04.421Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS56',6,0,1,2,'2026-10-22T13:11:25.176Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS59',6,3,1,2,'2026-10-22T13:12:15.481Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS40',8,0,2,2,'2026-10-22T13:14:43.866Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS10',5,1,1,2,'2026-10-22T13:17:01.125Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS21',5,1,1,2,'2026-10-25T10:20:46.146Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS63',5,2,1,2,'2026-10-22T13:38:58.429Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS89',0,0,0,2,'2026-10-25T10:19:24.848Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS86B',0,0,0,2,'2026-10-25T10:19:26.718Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS86',0,0,0,2,'2026-10-25T10:19:27.380Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS77',0,0,0,2,'2026-10-25T10:19:28.045Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS82',0,0,0,2,'2026-10-25T10:19:28.837Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS85',0,0,0,2,'2026-10-25T10:19:29.476Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS76',0,0,0,2,'2026-10-25T10:19:30.269Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS66',0,0,0,2,'2026-10-25T10:19:30.886Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS58',0,0,0,2,'2026-10-25T10:19:32.788Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS54',0,0,0,2,'2026-10-25T10:19:33.571Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS53',0,0,0,2,'2026-10-25T10:19:34.293Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS47',0,0,0,2,'2026-10-25T10:19:34.884Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS11',0,0,0,2,'2026-10-25T10:19:37.348Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS12',0,0,0,2,'2026-10-25T10:19:38.651Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS18',0,0,0,2,'2026-10-25T10:19:39.348Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS22',0,0,0,2,'2026-10-25T10:19:40.148Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS36',0,0,0,2,'2026-10-25T10:19:41.285Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS42',0,0,0,2,'2026-10-25T10:19:42.180Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS44',0,0,0,2,'2026-10-25T10:19:42.809Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS81',5,2,2,2,'2026-10-25T10:28:47.277Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS71',6,2,2,2,'2026-10-25T10:28:47.914Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS45',9,2,1,2,'2026-10-25T10:28:48.548Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.store_equipment(store_code,p6_qty,co2_qty,fs_qty,hc_total,updated_at) values ('DS14',6,1,1,2,'2026-10-25T10:28:50.293Z'::timestamptz) on conflict (store_code) do nothing;
insert into public.equipment_types(code,name_ar,name_en,has_quantity,sort) values
  ('p6','طفايات بودرة 6 كجم','6 kg powder extinguishers',true,1),
  ('co2','طفايات CO2','CO2 extinguishers',true,2),
  ('fs','معدات Fire Search','Fire Search equipment',true,3),
  ('hc','خزائن خراطيم الحريق','Hose cabinets',true,4),
  ('al','نظام إنذار الحريق','Fire alarm system',false,5),
  ('fp','طرمبة الحريق','Fire pump',false,6)
on conflict (code) do nothing;
insert into public.app_settings(key,value) values
  ('app_name_ar','"إدارة السلامة من الحريق"'),('app_name_en','"Fire Safety Management"'),
  ('login_message_ar','"سجّل دخولك باسم المستخدم وكلمة المرور"'),('login_message_en','"Sign in with your username and password"'),
  ('overdue_days','7'),('require_remarks_on_issue','false'),('session_idle_minutes','480'),('week_deadline_dow','6')
on conflict (key) do nothing;
commit;

-- Expected counts after this migration:
--   zones=4 staff=5 stores=66 store_equipment=54 equipment_types=6
-- WARNING: 12 stores have no base quantities: DS23, DS37, DS39, DS46, DS52, DS64, DS72, DS74, DS87, DS_CITYSTARS2, DS_SHOROUK3, DS_TAGAMOA10

-- ===== supabase/migrations/20261120000004_explicit_grants.sql =====
-- Newer Supabase projects do not auto-expose new tables to the API roles.
-- Grant exactly what the app needs; RLS still decides which ROWS each user sees.
grant usage on schema public to authenticated, service_role;

grant select, insert, update on public.zones, public.staff, public.stores, public.store_equipment, public.app_settings to authenticated;
grant select, update on public.equipment_types to authenticated;
grant select on public.inspections, public.issues, public.issue_events, public.audit_logs, public.v_store_status to authenticated;

-- Edge Function (service role) manages login links and writes audit rows
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- anon: nothing except the login-screen settings RPC (granted in 20261120000002)
revoke all on all tables in schema public from anon;

-- ===== supabase/migrations/20261120000005_tech_store_scope.sql =====
-- ═══════════════════════════════════════════════════════════════════
-- Admin option: which stores a technician works on.
--   'assigned' (default) → stores assigned to the technician by name
--   'zone'               → assigned stores + every store in the technician's zone
-- One helper decides access everywhere (RLS + submit_inspection), so UI and API always agree.
-- ═══════════════════════════════════════════════════════════════════
alter table public.app_settings drop constraint if exists app_settings_key_check;
alter table public.app_settings add constraint app_settings_key_check check (key in (
  'app_name_ar','app_name_en','login_message_ar','login_message_en',
  'overdue_days','require_remarks_on_issue','session_idle_minutes','week_deadline_dow','tech_store_scope'));
insert into public.app_settings(key, value) values ('tech_store_scope', '"assigned"') on conflict (key) do nothing;

create or replace function public.can_access_store(p_store text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.stores s
    join public.staff me on me.auth_user_id = auth.uid() and me.active
    where s.store_code = p_store
      and ( me.role = 'admin'
         or s.assigned_tech_id = me.id
         or ( coalesce((select value #>> '{}' from public.app_settings where key = 'tech_store_scope'), 'assigned') = 'zone'
              and me.zone_id is not null and s.zone_id = me.zone_id ) )
  )
$$;

drop policy if exists stores_read on public.stores;
create policy stores_read on public.stores for select to authenticated
  using (public.is_admin() or public.can_access_store(store_code));

drop policy if exists se_read on public.store_equipment;
create policy se_read on public.store_equipment for select to authenticated
  using (public.is_admin() or public.can_access_store(store_code));

drop policy if exists iss_read on public.issues;
create policy iss_read on public.issues for select to authenticated
  using (public.is_admin() or public.can_access_store(store_code));

-- technicians also see inspections of stores they can work on (so "inspected this week"
-- is correct when two technicians share a zone)
drop policy if exists ins_read on public.inspections;
create policy ins_read on public.inspections for select to authenticated
  using (public.is_admin() or tech_id = public.current_staff_id() or public.can_access_store(store_code));

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
  if not public.can_access_store(st.store_code) then raise exception 'STORE_NOT_ASSIGNED'; end if;

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

revoke execute on all functions in schema public from public, anon;
grant execute on function public.public_settings() to anon, authenticated;
grant execute on function public.can_access_store(text), public.submit_inspection(jsonb) to authenticated;

-- ===== supabase/migrations/20261121000006_phone_login.sql =====
-- ═══════════════════════════════════════════════════════════════════
-- Sign in with mobile number (+ password).
-- The number is the one saved on the user's staff record (Users page).
-- No SMS provider is needed: the password is still checked by Supabase Auth.
-- ═══════════════════════════════════════════════════════════════════
create or replace function public.normalize_phone(p text) returns text
language sql immutable set search_path = public as $$
  select case
           when d ~ '^0020(1[0-9]{9})$' then '0' || substr(d, 5)
           when d ~ '^20(1[0-9]{9})$'   then '0' || substr(d, 3)
           when d ~ '^1[0-9]{9}$'       then '0' || d
           else d end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;

create index if not exists staff_phone_norm_idx on public.staff (public.normalize_phone(phone)) where phone is not null;

-- Returns the login e-mail for a mobile number. Unknown, inactive or shared numbers get an address
-- that cannot sign in, so the answer looks the same and the password check fails normally.
create or replace function public.login_email(p_identifier text) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text := trim(coalesce(p_identifier, '')); n text; e text; c int;
begin
  if v !~ '^[+0-9 ()-]{8,20}$' then return null; end if;          -- not a phone: the app uses the username
  n := public.normalize_phone(v);
  select count(*), min(u.email) into c, e
    from public.staff s join auth.users u on u.id = s.auth_user_id
   where s.active and s.phone is not null and public.normalize_phone(s.phone) = n;
  if c = 1 then return e; end if;
  return 'nobody-' || md5(n) || '@invalid.local';
end $$;

-- a number may belong to one active person only (checked on save, so existing data is never blocked)
create or replace function public.staff_phone_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.phone is not null and length(public.normalize_phone(new.phone)) > 0
     and (tg_op = 'INSERT' or public.normalize_phone(new.phone) is distinct from public.normalize_phone(old.phone))
     and exists (select 1 from public.staff s where s.id <> new.id and s.active and public.normalize_phone(s.phone) = public.normalize_phone(new.phone)) then
    raise exception 'PHONE_TAKEN';
  end if;
  return new;
end $$;
drop trigger if exists trg_staff_phone on public.staff;
create trigger trg_staff_phone before insert or update of phone on public.staff for each row execute function public.staff_phone_guard();

revoke execute on all functions in schema public from public, anon;
grant execute on function public.public_settings(), public.login_email(text) to anon, authenticated;
grant execute on function public.normalize_phone(text) to authenticated;

-- sign-in texts now mention the mobile number (only if still the original default)
update public.app_settings set value = '"ادخل برقم موبايلك أو اسم المستخدم وكلمة المرور"' where key = 'login_message_ar' and value = '"سجّل دخولك باسم المستخدم وكلمة المرور"';
update public.app_settings set value = '"Sign in with your mobile number or username and password"' where key = 'login_message_en' and value = '"Sign in with your username and password"';

-- ===== supabase/migrations/20261121000007_pin_login.sql =====
-- ═══════════════════════════════════════════════════════════════════
-- PIN sign-in (4–6 digits) as a second way in, next to the password.
--  • PINs are stored only as bcrypt hashes, in a table no app role can read.
--  • 5 wrong PINs → locked 15 minutes; 15 in a row → PIN disabled until the
--    user signs in with the password and sets a new PIN (or an admin resets it).
--  • The check runs only inside the pin-login Edge Function (service role).
-- ═══════════════════════════════════════════════════════════════════
create extension if not exists pgcrypto;

create table if not exists public.staff_pins (
  staff_id     uuid primary key references public.staff(id) on delete cascade,
  pin_hash     text not null,
  failed       int  not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);
alter table public.staff_pins enable row level security;     -- no policies: invisible to anon/authenticated
revoke all on public.staff_pins from anon, authenticated;
grant all on public.staff_pins to service_role;

create or replace function public.pin_is_weak(p text) returns boolean
language sql immutable set search_path = public as $$
  select p !~ '^[0-9]{4,6}$'
      or p ~ '^(.)\1+$'                                        -- 1111, 000000
      or position(p in '0123456789012345') > 0                -- 1234, 345678, 9012
      or position(p in '9876543210987654') > 0                -- 4321, 987654
$$;

create or replace function public._hash_pin(p text) returns text
language sql volatile set search_path = public, extensions as $$ select crypt(p, gen_salt('bf', 8)) $$;

-- the signed-in user sets / changes their own PIN
create or replace function public.set_my_pin(p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := public.current_staff_id();
begin
  if me is null then raise exception 'NOT_AUTHORIZED'; end if;
  if public.pin_is_weak(p_pin) then raise exception 'WEAK_PIN'; end if;
  insert into public.staff_pins(staff_id, pin_hash, failed, locked_until, updated_at)
  values (me, public._hash_pin(p_pin), 0, null, now())
  on conflict (staff_id) do update set pin_hash = excluded.pin_hash, failed = 0, locked_until = null, updated_at = now();
  insert into public.audit_logs(actor_auth, actor_staff, action, entity, entity_id) values (auth.uid(), me, 'set_pin', 'auth', me::text);
end $$;

create or replace function public.my_pin_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('has_pin', p.staff_id is not null, 'locked', coalesce(p.locked_until > now(), false))
  from (select public.current_staff_id() as me) x left join public.staff_pins p on p.staff_id = x.me
$$;

create or replace function public.clear_my_pin() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.current_staff_id();
begin
  if me is null then raise exception 'NOT_AUTHORIZED'; end if;
  delete from public.staff_pins where staff_id = me;
  insert into public.audit_logs(actor_auth, actor_staff, action, entity, entity_id) values (auth.uid(), me, 'clear_pin', 'auth', me::text);
end $$;

-- admin: set a starting PIN for someone, or remove it (p_pin null)
create or replace function public.admin_set_pin(p_staff uuid, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  if p_pin is null then
    delete from public.staff_pins where staff_id = p_staff;
  else
    if public.pin_is_weak(p_pin) then raise exception 'WEAK_PIN'; end if;
    insert into public.staff_pins(staff_id, pin_hash) values (p_staff, public._hash_pin(p_pin))
    on conflict (staff_id) do update set pin_hash = excluded.pin_hash, failed = 0, locked_until = null, updated_at = now();
  end if;
  insert into public.audit_logs(actor_auth, actor_staff, action, entity, entity_id)
  values (auth.uid(), public.current_staff_id(), case when p_pin is null then 'admin_clear_pin' else 'admin_set_pin' end, 'auth', p_staff::text);
end $$;

create or replace function public.admin_pin_list() returns setof uuid
language sql stable security definer set search_path = public as $$
  select staff_id from public.staff_pins where public.is_admin()
$$;

-- service role only: resolve identifier (mobile or username) + check PIN. Returns the login e-mail on success.
create or replace function public.pin_check(p_identifier text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v text := lower(trim(coalesce(p_identifier, ''))); s public.staff; e text; pr public.staff_pins;
begin
  if v ~ '^[+0-9 ()-]{8,20}$' then
    if (select count(*) from public.staff st where st.active and st.phone is not null
          and public.normalize_phone(st.phone) = public.normalize_phone(v)) = 1 then
      select st.* into s from public.staff st where st.active and st.auth_user_id is not null and st.phone is not null
        and public.normalize_phone(st.phone) = public.normalize_phone(v);
    end if;
  else
    select st.* into s from public.staff st where st.active and st.auth_user_id is not null and st.username = v;
  end if;
  if s.id is null then perform crypt(coalesce(p_pin,''), gen_salt('bf', 8)); return jsonb_build_object('error','BAD'); end if;

  select * into pr from public.staff_pins where staff_id = s.id for update;
  if pr.staff_id is null then perform crypt(coalesce(p_pin,''), gen_salt('bf', 8)); return jsonb_build_object('error','BAD'); end if;
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

revoke execute on all functions in schema public from public, anon;
grant execute on function public.public_settings(), public.login_email(text) to anon, authenticated;
grant execute on function public.set_my_pin(text), public.my_pin_status(), public.clear_my_pin(),
  public.admin_set_pin(uuid, text), public.admin_pin_list() to authenticated;
revoke execute on function public.pin_check(text, text), public._hash_pin(text) from authenticated;
grant execute on function public.pin_check(text, text) to service_role;
