-- Run after migrations on a scratch database. Every block raises if an expectation fails.
\set ON_ERROR_STOP 1
insert into auth.users values ('00000000-0000-0000-0000-00000000000a','admin01@fs.local'),
  ('00000000-0000-0000-0000-000000000002','tech002@fs.local'),('00000000-0000-0000-0000-000000000003','tech003@fs.local');
select public.bootstrap_admin('admin01@fs.local');
set request.jwt.claim.role = 'service_role';
update public.staff set auth_user_id='00000000-0000-0000-0000-000000000002' where legacy_code='TECH002';
update public.staff set auth_user_id='00000000-0000-0000-0000-000000000003' where legacy_code='TECH003';
reset request.jwt.claim.role;

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); perform set_config('request.jwt.claim.role','authenticated', false); end $$;
create or replace function pg_temp.expect(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'TEST FAILED: %', msg; end if; raise notice 'ok - %', msg; end $$;

-- anon sees nothing
set role anon;
do $$ begin
  begin perform count(*) from public.stores; raise exception 'TEST FAILED: anon read stores';
  exception when insufficient_privilege then raise notice 'ok - anon blocked from stores'; end;
end $$;
select pg_temp.expect(public.public_settings() ? 'app_name_ar', 'anon can read login texts only');
reset role;

-- technician TECH002 (Zone 2, 13 stores)
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
set role authenticated;
select pg_temp.expect((select count(*) from public.stores) = 13, 'tech sees only own 13 stores');
select pg_temp.expect((select count(*) from public.staff) = 1, 'tech sees only own staff row');
select pg_temp.expect((select count(*) from public.audit_logs) = 0, 'tech cannot read audit');
do $$ begin
  update public.store_equipment set p6_qty = 99 where store_code='DS1';
  if found then raise exception 'TEST FAILED: tech updated base qty'; end if; raise notice 'ok - tech cannot change base qty';
end $$;
do $$ begin
  begin update public.staff set role='admin' where legacy_code='TECH002';
    if found then raise exception 'TEST FAILED: privilege escalation'; end if;
  exception when others then null; end; raise notice 'ok - tech cannot escalate role';
end $$;
do $$ begin
  begin insert into public.inspections(client_id,store_code,tech_id,week_start,inspection_date,store_name_snapshot,zone_snapshot,tech_name_snapshot,overall_status)
        values (gen_random_uuid(),'DS1',public.current_staff_id(),'2026-11-15','2026-11-20','x','x','x','ok');
        raise exception 'TEST FAILED: direct insert allowed';
  exception when insufficient_privilege then raise notice 'ok - direct inspection insert blocked'; end;
end $$;
-- wrong sum
do $$ begin
  begin perform public.submit_inspection('{"client_id":"11111111-1111-1111-1111-111111111111","store_code":"DS1","p6":{"good":1,"dmg":0,"miss":0},"co2":{"good":0,"dmg":0,"miss":0},"fs":{"good":0,"dmg":0,"miss":0},"hc":{"ok":0,"hose":"good","valve":"good","glass":"good"},"al":{"system":"ok","battery":"good","detectors":"good","mcp":"good","sounders":"working"},"fp":{"available":false}}'::jsonb);
    raise exception 'TEST FAILED: mismatch accepted';
  exception when others then if sqlerrm not like 'COUNT_MISMATCH%' then raise; end if; raise notice 'ok - count mismatch rejected (%)', sqlerrm; end;
end $$;
-- store of another technician
do $$ begin
  begin perform public.submit_inspection('{"client_id":"22222222-2222-2222-2222-222222222222","store_code":"DS3"}'::jsonb);
    raise exception 'TEST FAILED: foreign store accepted';
  exception when others then if sqlerrm not in ('STORE_NOT_ASSIGNED','STORE_NOT_FOUND') then raise; end if; raise notice 'ok - other technician store rejected (%)', sqlerrm; end;
end $$;
-- valid submission with damage + alarm fault (DS1 base: read it)
select format('{"client_id":"33333333-3333-3333-3333-333333333333","store_code":"DS1","p6":{"good":%s,"dmg":1,"miss":0},"co2":{"good":%s,"dmg":0,"miss":0},"fs":{"good":%s,"dmg":0,"miss":0},"hc":{"ok":%s,"hose":"damaged","valve":"good","glass":"good"},"al":{"system":"fault","battery":"low","detectors":"good","mcp":"good","sounders":"working"},"fp":{"available":true,"running":"running","tested":"tested"}}',
  p6_qty-1, co2_qty, fs_qty, hc_total) as payload from public.store_equipment where store_code='DS1' \gset
select set_config('fs.payload', :'payload', false);
select public.submit_inspection(:'payload'::jsonb) as res \gset
select pg_temp.expect((:'res'::jsonb->>'overall') = 'warn', 'submission accepted, overall=warn');
select pg_temp.expect(jsonb_array_length(:'res'::jsonb->'issues') = 3, 'issues created server-side (p6, hose, alarm)');
select pg_temp.expect((select priority::text from public.issues where equipment='al') = 'critical', 'alarm fault is critical');
-- replay = idempotent
select pg_temp.expect((public.submit_inspection(:'payload'::jsonb)->>'replayed')::boolean, 'replay returns existing record');
-- duplicate week with new client id
do $$ begin
  begin perform public.submit_inspection(replace(current_setting('fs.payload'),'33333333','44444444')::jsonb);
  exception when others then if sqlerrm <> 'DUPLICATE_WEEK' then raise; end if; raise notice 'ok - duplicate week blocked'; return; end;
  raise exception 'TEST FAILED: duplicate accepted';
end $$;
select pg_temp.expect((select count(*) from public.issues) = 3, 'tech sees issues of own store');
do $$ begin
  begin perform public.update_issue((select id from public.issues limit 1),'resolved',null,'fixed');
  exception when others then if sqlerrm <> 'NOT_AUTHORIZED' then raise; end if; raise notice 'ok - tech cannot resolve issues'; return; end;
  raise exception 'TEST FAILED';
end $$;
reset role;

-- technician TECH003 cannot see TECH002 data
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
set role authenticated;
select pg_temp.expect((select count(*) from public.inspections) = 0, 'tech3 cannot read tech2 inspections');
select pg_temp.expect((select count(*) from public.issues) = 0, 'tech3 cannot read tech2 issues');
reset role;

-- admin
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select pg_temp.expect((select count(*) from public.stores) = 66, 'admin sees all stores');
select public.update_issue((select id from public.issues where equipment='al'),'assigned',(select id from public.staff where legacy_code='TECH002'),null);
do $$ begin
  begin perform public.update_issue((select id from public.issues where equipment='al'),'resolved',null,null);
  exception when others then if sqlerrm <> 'RESOLUTION_NOTES_REQUIRED' then raise; end if; raise notice 'ok - resolution needs notes'; return; end;
  raise exception 'TEST FAILED';
end $$;
select public.update_issue((select id from public.issues where equipment='al'),'resolved',null,'Battery replaced');
select pg_temp.expect((select status::text from public.issues where equipment='al')='resolved', 'admin resolved issue');
select pg_temp.expect((select inspection_id is not null from public.issues where equipment='al'), 'resolved issue keeps inspection link');
update public.store_equipment set p6_qty = p6_qty where store_code='DS2';
update public.stores set name='Dokki (renamed)' where store_code='DS2';
select pg_temp.expect((select count(*) from public.stores where store_code='DS2' and name='Dokki (renamed)')=1, 'rename keeps store_code');
select pg_temp.expect((public.dashboard_summary()->>'stores')::int = 66, 'dashboard counts from rows');
select pg_temp.expect((public.dashboard_summary()->'by_status'->>'issues')::int = 1, 'dashboard shows DS1 with issues');
do $$ begin
  begin update public.staff set active=false where legacy_code='ADMIN01';
  exception when others then if sqlerrm <> 'LAST_ADMIN' then raise; end if; raise notice 'ok - cannot disable last admin'; return; end;
  raise exception 'TEST FAILED';
end $$;
do $$ begin
  begin update public.staff set auth_user_id=null where legacy_code='TECH003';
  exception when others then if sqlerrm <> 'AUTH_LINK_LOCKED' then raise; end if; raise notice 'ok - login link locked from API'; return; end;
  raise exception 'TEST FAILED';
end $$;
select pg_temp.expect((select count(*) from public.audit_logs where entity='stores' and action='update')>=1, 'store rename audited');
do $$ begin
  begin delete from public.audit_logs; exception when insufficient_privilege then raise notice 'ok - audit log not deletable'; return; end;
  raise exception 'TEST FAILED: audit deletable';
end $$;
reset role;
-- anon cannot call business RPCs
set role anon;
do $$ begin
  begin perform public.submit_inspection('{}'::jsonb); raise exception 'TEST FAILED: anon rpc';
  exception when insufficient_privilege then raise notice 'ok - anon cannot call submit_inspection'; end;
  begin perform public.bootstrap_admin('x@y'); raise exception 'TEST FAILED: anon bootstrap';
  exception when insufficient_privilege then raise notice 'ok - anon cannot call bootstrap_admin'; end;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
set role authenticated;
do $$ begin
  begin perform public.bootstrap_admin('tech002@fs.local'); raise exception 'TEST FAILED: tech bootstrap';
  exception when insufficient_privilege then raise notice 'ok - technician cannot call bootstrap_admin'; end;
end $$;
reset role;
