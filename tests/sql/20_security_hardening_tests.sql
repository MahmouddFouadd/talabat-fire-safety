-- Security review checks (run after 10_rls_and_rpc_tests.sql on the same scratch database).
-- Tries the attacks a technician could make by calling the API directly, not through the UI.
\set ON_ERROR_STOP 1
reset role; reset request.jwt.claim.sub; reset request.jwt.claim.role;
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); perform set_config('request.jwt.claim.role','authenticated', false); end $$;
create or replace function pg_temp.expect(ok boolean, msg text) returns void language plpgsql as $$
begin if not ok then raise exception 'TEST FAILED: %', msg; end if; raise notice 'ok - %', msg; end $$;

-- fixtures: a fresh store of TECH002 with base quantities and nothing inspected
insert into public.stores(store_code, name, zone_id, assigned_tech_id)
select 'SEC1', 'Security test store', zone_id, id from public.staff where legacy_code = 'TECH002'
on conflict (store_code) do nothing;
insert into public.store_equipment(store_code, p6_qty, co2_qty, fs_qty, hc_total) values ('SEC1', 2, 1, 0, 0) on conflict do nothing;
select id as admin_id from public.staff where legacy_code = 'ADMIN01' \gset
\set ok_payload '{"client_id":"aaaaaaaa-0000-4000-8000-000000000001","store_code":"SEC1","tech_id":"' :admin_id '","week_start":"2020-01-05","inspection_date":"2020-01-01","p6":{"good":2,"dmg":0,"miss":0},"co2":{"good":1,"dmg":0,"miss":0},"fs":{"good":0,"dmg":0,"miss":0},"hc":{"ok":0,"hose":"good","valve":"good","glass":"good"},"al":{"system":"ok","battery":"good","detectors":"good","mcp":"good","sounders":"working"},"fp":{"available":false}}'

-- ── privileges ──
select pg_temp.expect(not has_table_privilege('authenticated', 'public.audit_logs', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.inspections', 'TRUNCATE'), 'API roles have no TRUNCATE (it would bypass RLS)');
select pg_temp.expect(not has_function_privilege('authenticated', 'public._submit_inspection_impl(jsonb)', 'execute'), 'inner submit function not callable directly');
select pg_temp.expect(not has_function_privilege('authenticated', 'public.revoke_user_sessions(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.revoke_user_sessions(uuid)', 'execute'), 'session revocation is service-role only');
select pg_temp.expect(not has_function_privilege('anon', 'public.log_event(text, jsonb)', 'execute'), 'anon cannot write audit events');
select pg_temp.expect((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('public_settings', 'login_email', 'request_source')) = 0, 'anon can run only the two login-screen functions');

-- ── technician forging fields in the payload ──
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
set role authenticated;
select public.submit_inspection(:'ok_payload'::jsonb) as r1 \gset
select pg_temp.expect((select tech_id from public.inspections where client_id = 'aaaaaaaa-0000-4000-8000-000000000001') = public.current_staff_id(),
  'forged tech_id in payload is ignored (server uses the signed-in user)');
select pg_temp.expect((select week_start = public.week_start_of(public.cairo_today()) and inspection_date = public.cairo_today()
  from public.inspections where client_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 'forged dates are ignored (server clock decides the week)');
select pg_temp.expect((public.submit_inspection(:'ok_payload'::jsonb)->>'replayed')::boolean, 'resend with same client_id returns the saved record (no duplicate)');
select pg_temp.expect((select count(*) from public.inspections where store_code = 'SEC1') = 1, 'still exactly one inspection after the resend');
do $$ begin
  perform public.submit_inspection('{"client_id":"aaaaaaaa-0000-4000-8000-000000000002","store_code":"SEC1","override":true,"override_reason":"x","p6":{"good":2,"dmg":0,"miss":0},"co2":{"good":1,"dmg":0,"miss":0},"fs":{"good":0,"dmg":0,"miss":0},"hc":{"ok":0,"hose":"good","valve":"good","glass":"good"},"al":{"system":"ok","battery":"good","detectors":"good","mcp":"good","sounders":"working"},"fp":{"available":false}}'::jsonb);
  raise exception 'TEST FAILED: technician override accepted';
exception when others then if sqlerrm <> 'OVERRIDE_ADMIN_ONLY' then raise; end if; raise notice 'ok - technician cannot force a second inspection with override=true';
end $$;
do $$ begin
  perform public.log_event('export_csv', '{"table":"x"}'::jsonb); raise exception 'TEST FAILED: tech wrote audit event';
exception when others then if sqlerrm <> 'NOT_AUTHORIZED' then raise; end if; raise notice 'ok - technician cannot write audit events';
end $$;
do $$ begin
  perform public.revoke_user_sessions('00000000-0000-0000-0000-00000000000a'); raise exception 'TEST FAILED';
exception when insufficient_privilege then raise notice 'ok - technician cannot end other users sessions'; end $$;
reset role;

-- another technician replaying someone else's client_id learns nothing
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
set role authenticated;
do $$ begin
  perform public.submit_inspection('{"client_id":"aaaaaaaa-0000-4000-8000-000000000001","store_code":"SEC1"}'::jsonb);
  raise exception 'TEST FAILED: foreign replay allowed';
exception when others then if sqlerrm <> 'NOT_AUTHORIZED' then raise; end if; raise notice 'ok - replaying another technician''s inspection id is refused';
end $$;
reset role;

-- ── admin duplicate override: allowed only with a reason, and audited with who/when/why ──
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
set request.headers = '{"cf-connecting-ip":"203.0.113.7, 10.0.0.1","user-agent":"sec-test"}';
do $$ begin
  perform public.submit_inspection('{"client_id":"aaaaaaaa-0000-4000-8000-000000000003","store_code":"SEC1","override":true,"p6":{"good":2,"dmg":0,"miss":0},"co2":{"good":1,"dmg":0,"miss":0},"fs":{"good":0,"dmg":0,"miss":0},"hc":{"ok":0,"hose":"good","valve":"good","glass":"good"},"al":{"system":"ok","battery":"good","detectors":"good","mcp":"good","sounders":"working"},"fp":{"available":false}}'::jsonb);
  raise exception 'TEST FAILED: override without reason';
exception when others then if sqlerrm <> 'OVERRIDE_REASON_REQUIRED' then raise; end if; raise notice 'ok - admin override needs a reason';
end $$;
select public.submit_inspection('{"client_id":"aaaaaaaa-0000-4000-8000-000000000004","store_code":"SEC1","override":true,"override_reason":"re-check after fire drill","p6":{"good":2,"dmg":0,"miss":0},"co2":{"good":1,"dmg":0,"miss":0},"fs":{"good":0,"dmg":0,"miss":0},"hc":{"ok":0,"hose":"good","valve":"good","glass":"good"},"al":{"system":"ok","battery":"good","detectors":"good","mcp":"good","sounders":"working"},"fp":{"available":false}}'::jsonb) as r2 \gset
select pg_temp.expect((select count(*) from public.audit_logs where action = 'duplicate_override'
  and detail->>'reason' = 're-check after fire drill' and actor_staff = public.current_staff_id() and detail ? 'approved_at') = 1,
  'admin duplicate override is audited with reason, approver and time');
select pg_temp.expect((select source->>'ip' from public.audit_logs where action = 'duplicate_override' order by id desc limit 1) = '203.0.113.7',
  'audit rows record the client IP');
select public.log_event('export_csv', '{"table":"inspections","rows":12}'::jsonb);
select pg_temp.expect((select count(*) from public.audit_logs where action = 'export_csv' and entity_id = 'inspections' and source->>'ua' = 'sec-test') = 1, 'admin export is audited');
do $$ begin
  perform public.log_event('delete_everything', null); raise exception 'TEST FAILED';
exception when others then if sqlerrm <> 'INVALID_ACTION' then raise; end if; raise notice 'ok - only known audit event names accepted';
end $$;
reset request.headers;

-- dashboard ignores issues of inactive stores
reset role;
insert into public.issues(issue_code, store_code, equipment, description, priority) values ('SEC-ISS-1', 'SEC1', 'p6', 'test', 'high');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select (public.dashboard_summary()->>'open_issues')::int as open_before \gset
update public.stores set active = false where store_code = 'SEC1';
select pg_temp.expect((public.dashboard_summary()->>'open_issues')::int = :open_before - 1, 'inactive stores are left out of open-issue KPIs');
update public.stores set active = true where store_code = 'SEC1';
reset role;

-- ── audit log cannot be changed, even by the service role / owner through SQL ──
do $$ begin
  update public.audit_logs set action = 'tampered' where id = (select max(id) from public.audit_logs);
  raise exception 'TEST FAILED: audit updated';
exception when others then if sqlerrm <> 'AUDIT_LOG_IMMUTABLE' then raise; end if; raise notice 'ok - audit rows cannot be edited';
end $$;
do $$ begin
  delete from public.audit_logs; raise exception 'TEST FAILED: audit deleted';
exception when others then if sqlerrm <> 'AUDIT_LOG_IMMUTABLE' then raise; end if; raise notice 'ok - audit rows cannot be deleted';
end $$;
do $$ begin
  truncate public.audit_logs; raise exception 'TEST FAILED: audit truncated';
exception when others then if sqlerrm <> 'AUDIT_LOG_IMMUTABLE' then raise; end if; raise notice 'ok - audit log cannot be truncated';
end $$;

-- ── PIN: a made-up account behaves exactly like a real one (no username/phone discovery) ──
set request.jwt.claim.role = 'service_role';
select pg_temp.expect((public.pin_check('ghost.user', '2580')->>'error') = 'BAD', 'unknown user: wrong PIN → BAD');
select public.pin_check('ghost.user', '2580'), public.pin_check('ghost.user', '2580'), public.pin_check('ghost.user', '2580') \gset
select pg_temp.expect((public.pin_check('ghost.user', '2580')->>'error') = 'BAD', 'unknown user: 5th try → BAD');
select pg_temp.expect((public.pin_check('ghost.user', '2580')->>'error') = 'LOCKED', 'unknown user is "locked" after 5 tries, same as a real account');
select pg_temp.expect((public.pin_check('01000000999', '2580')->>'error') = 'BAD', 'unknown mobile number gives BAD');
select pg_temp.expect((select count(*) from public.pin_attempts where key like '%ghost%') = 0, 'attempt table stores hashes, not identifiers');
select pg_temp.expect((public.pin_check('tech002', '3691')->>'ok')::boolean, 'real account with the right PIN still signs in');
reset request.jwt.claim.role;
