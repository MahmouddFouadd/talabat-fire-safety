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
