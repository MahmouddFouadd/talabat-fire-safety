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
