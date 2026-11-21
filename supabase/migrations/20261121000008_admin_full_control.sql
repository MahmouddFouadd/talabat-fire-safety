-- ═══════════════════════════════════════════════════════════════════
-- Admin full control:
--  • stores can be left without a zone (zone edit: add / remove stores)
--  • admins can add NEW equipment types (count or check), assign them to any stores,
--    and they appear in the technician's inspection automatically
--  • admin delete actions for stores, zones, staff, issues, inspections, equipment types
-- ═══════════════════════════════════════════════════════════════════
alter table public.stores alter column zone_id drop not null;

alter table public.equipment_types drop constraint if exists equipment_types_code_check;
alter table public.equipment_types add constraint equipment_types_code_check check (code ~ '^[a-z][a-z0-9_]{1,30}$');
alter table public.equipment_types add column if not exists kind text not null default 'builtin' check (kind in ('builtin','count','check'));
alter table public.equipment_types add column if not exists icon text check (icon is null or icon ~ '^[a-z0-9_]{1,20}$');
alter table public.equipment_types add column if not exists issue_priority public.issue_priority not null default 'medium';
update public.equipment_types set kind = 'builtin' where code in ('p6','co2','fs','hc','al','fp');

-- quantities of custom equipment per store (built-in ones stay in store_equipment)
create table if not exists public.store_items (
  store_code text not null references public.stores(store_code) on update cascade on delete cascade,
  type_code  text not null references public.equipment_types(code) on update cascade on delete cascade,
  qty        int  not null check (qty between 0 and 9999),
  updated_at timestamptz not null default now(),
  primary key (store_code, type_code)
);
create table if not exists public.inspection_items (
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  type_code text not null references public.equipment_types(code) on update cascade,
  kind      text not null check (kind in ('count','check')),
  qty int not null default 0, good int, dmg int, miss int, ok boolean,
  status text not null check (status in ('ok','issue')),
  rmk text check (rmk is null or length(rmk) <= 1000),
  primary key (inspection_id, type_code),
  check (kind <> 'count' or (good + dmg + miss = qty and least(good, dmg, miss) >= 0))
);
alter table public.store_items enable row level security;
alter table public.inspection_items enable row level security;
drop policy if exists si_read on public.store_items;
create policy si_read on public.store_items for select to authenticated using (public.is_admin() or public.can_access_store(store_code));
drop policy if exists si_admin on public.store_items;
create policy si_admin on public.store_items for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists ii_read on public.inspection_items;
create policy ii_read on public.inspection_items for select to authenticated using (
  public.is_admin() or exists (select 1 from public.inspections i where i.id = inspection_id
                                and (i.tech_id = public.current_staff_id() or public.can_access_store(i.store_code))));
grant select, insert, update, delete on public.store_items to authenticated;
grant select on public.inspection_items to authenticated;
grant all on public.store_items, public.inspection_items to service_role;
drop policy if exists eqt_admin_ins on public.equipment_types;
create policy eqt_admin_ins on public.equipment_types for insert to authenticated with check (public.is_admin() and kind in ('count','check'));
grant insert on public.equipment_types to authenticated;
drop trigger if exists trg_touch on public.store_items;
create trigger trg_touch before update on public.store_items for each row execute function public.touch_updated_at();
drop trigger if exists trg_audit on public.store_items;
create trigger trg_audit after insert or update or delete on public.store_items for each row execute function public.audit_row();

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
  ct record; v_items jsonb := '[]'::jsonb;
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

  -- custom equipment types assigned to this store (added by admins from the UI)
  for ct in
    select et.code, et.kind, et.name_ar, et.issue_priority, si.qty
      from public.equipment_types et
      join public.store_items si on si.type_code = et.code and si.store_code = st.store_code
     where et.active and et.kind in ('count','check') and si.qty > 0
     order by et.sort, et.code
  loop
    it := p->'items'->ct.code;
    if it is null then raise exception 'MISSING_FIELD:%', ct.code; end if;
    if ct.kind = 'count' then
      g := coalesce((it->>'good')::int, -1); d := coalesce((it->>'dmg')::int, -1); m := coalesce((it->>'miss')::int, -1);
      if least(g, d, m) < 0 then raise exception 'INVALID_COUNT:%', ct.code; end if;
      if g + d + m <> ct.qty then raise exception 'COUNT_MISMATCH:%:%', ct.code, ct.qty; end if;
      v_items := v_items || jsonb_build_object('code', ct.code, 'kind', 'count', 'qty', ct.qty, 'good', g, 'dmg', d, 'miss', m,
        'status', case when d + m > 0 then 'issue' else 'ok' end, 'rmk', nullif(trim(it->>'rmk'), ''), 'prio', ct.issue_priority::text, 'name', ct.name_ar);
    else
      if (it->>'ok') is null then raise exception 'MISSING_FIELD:%', ct.code; end if;
      v_items := v_items || jsonb_build_object('code', ct.code, 'kind', 'check', 'qty', ct.qty, 'ok', (it->>'ok')::boolean,
        'status', case when (it->>'ok')::boolean then 'ok' else 'issue' end, 'rmk', nullif(trim(it->>'rmk'), ''), 'prio', ct.issue_priority::text, 'name', ct.name_ar);
    end if;
  end loop;

  r.general_remarks := nullif(trim(p->>'general_remarks'),'');
  r.overall_status := case when 'issue' in (r.p6_status, r.co2_status, r.fs_status, r.hc_status, r.al_status, r.fp_status)
                           or exists (select 1 from jsonb_array_elements(v_items) x where x->>'status' = 'issue') then 'warn' else 'ok' end;
  r.duplicate_override := v_override; r.override_reason := case when v_override then trim(p->>'override_reason') end;
  r.created_by := auth.uid();

  if req_rmk then
    if (r.p6_status='issue' and r.p6_rmk is null) or (r.co2_status='issue' and r.co2_rmk is null) or (r.fs_status='issue' and r.fs_rmk is null)
       or (r.hc_status='issue' and r.hc_rmk is null) or (r.al_status='issue' and r.al_rmk is null) or (r.fp_status='issue' and r.fp_rmk is null)
       or exists (select 1 from jsonb_array_elements(v_items) x where x->>'status' = 'issue' and x->>'rmk' is null) then
      raise exception 'REMARKS_REQUIRED';
    end if;
  end if;

  insert into public.inspections select r.*;
  insert into public.inspection_items(inspection_id, type_code, kind, qty, good, dmg, miss, ok, status, rmk)
  select r.id, x->>'code', x->>'kind', (x->>'qty')::int, (x->>'good')::int, (x->>'dmg')::int, (x->>'miss')::int, (x->>'ok')::boolean, x->>'status', x->>'rmk'
    from jsonb_array_elements(v_items) x;

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

  for it in select x from jsonb_array_elements(v_items) x where x->>'status' = 'issue' loop
    seq := seq + 1;
    insert into public.issues(issue_code, inspection_id, store_code, equipment, description, priority, created_by)
    values (r.inspection_code || '-' || lpad(seq::text, 2, '0'), r.id, r.store_code, it->>'code',
            case when it->>'kind' = 'count'
                 then concat_ws(' · ', nullif((it->>'dmg')::int, 0) || ' تالفة', nullif((it->>'miss')::int, 0) || ' مفقودة', 'من إجمالي ' || (it->>'qty'), it->>'rmk')
                 else concat_ws(' · ', 'يوجد مشكلة', it->>'rmk') end,
            case when it->>'kind' = 'count' and (it->>'miss')::int > 0 and it->>'prio' in ('medium','low') then 'high' else it->>'prio' end::public.issue_priority, me.id);
    v_issues := v_issues || jsonb_build_object('equipment', it->>'code', 'priority', it->>'prio');
  end loop;

  return jsonb_build_object('id', r.id, 'code', r.inspection_code, 'overall', r.overall_status, 'issues', v_issues, 'replayed', false);
end $$;

-- ── admin delete actions (each one audited by the row triggers) ──
create or replace function public.admin_delete_store(p_code text, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_ins int; n_iss int;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  select count(*) into n_ins from public.inspections where store_code = p_code;
  select count(*) into n_iss from public.issues where store_code = p_code;
  if (n_ins > 0 or n_iss > 0) and not p_force then
    return jsonb_build_object('needs_force', true, 'inspections', n_ins, 'issues', n_iss);
  end if;
  delete from public.issues where store_code = p_code;
  delete from public.inspections where store_code = p_code;
  delete from public.stores where store_code = p_code;
  if not found then raise exception 'STORE_NOT_FOUND'; end if;
  return jsonb_build_object('deleted', true, 'inspections', n_ins, 'issues', n_iss);
end $$;

create or replace function public.admin_delete_zone(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  update public.stores set zone_id = null where zone_id = p_id;
  update public.staff set zone_id = null where zone_id = p_id;
  delete from public.zones where id = p_id;
end $$;

create or replace function public.admin_delete_issue(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  delete from public.issues where id = p_id;
end $$;

create or replace function public.admin_delete_inspection(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  delete from public.issues where inspection_id = p_id;
  delete from public.inspections where id = p_id;
end $$;

-- staff with inspection history cannot be deleted (history keeps their name); deactivate instead
create or replace function public.admin_staff_can_delete(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() and not exists (select 1 from public.inspections where tech_id = p_id)
$$;

create or replace function public.admin_delete_equipment_type(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  if exists (select 1 from public.equipment_types where code = p_code and kind = 'builtin') then raise exception 'BUILTIN_TYPE'; end if;
  if exists (select 1 from public.inspection_items where type_code = p_code) or exists (select 1 from public.issues where equipment = p_code) then
    raise exception 'HAS_HISTORY';
  end if;
  delete from public.equipment_types where code = p_code;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.public_settings(), public.login_email(text) to anon, authenticated;
grant execute on function public.submit_inspection(jsonb), public.admin_delete_store(text, boolean), public.admin_delete_zone(uuid),
  public.admin_delete_issue(uuid), public.admin_delete_inspection(uuid), public.admin_staff_can_delete(uuid),
  public.admin_delete_equipment_type(text) to authenticated;
