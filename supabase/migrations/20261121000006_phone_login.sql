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
