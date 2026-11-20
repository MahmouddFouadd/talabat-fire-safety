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
