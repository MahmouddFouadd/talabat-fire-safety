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
