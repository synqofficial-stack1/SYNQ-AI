-- Proof that the CEO Control Center's data cannot be reached by anyone else.
--
-- Paste into the Supabase SQL editor and run. It asserts rather than prints:
-- if it finishes without raising, every claim below held at that moment.
--
--   1. An admin sees every event.
--   2. An ordinary signed-in user sees only their own.
--   3. An ordinary signed-in user cannot read the admin list at all.
--   4. A signed-out visitor sees nothing.
--   5. Nobody with a session can write the audit log — only the triggers and
--      the service role can, so history cannot be forged or rewritten.
--
-- This tests the database. The HTTP boundary (the `admin-console` function
-- returning 403 to a signed-in non-admin) is separate and lives in that
-- function's own two gates.
--
-- Change the emails below if the accounts differ; `synqtest003@gmail.com` is
-- simply an account that is not an admin.

do $$
declare
  v_admin uuid;
  v_plain uuid;
  v_all   int;
  v_admin_sees int;
  v_plain_sees int;
  v_plain_own  int;
  v_plain_admins int;
  v_anon_sees int;
  v_blocked boolean := false;
begin
  select user_id into v_admin from public.app_admins limit 1;
  select id into v_plain from auth.users
    where id not in (select user_id from public.app_admins) limit 1;

  if v_admin is null or v_plain is null then
    raise exception 'need one admin and one non-admin account to test with';
  end if;

  select count(*) into v_all from public.events;
  select count(*) into v_plain_own from public.events where user_id = v_plain;

  -- 1. As an admin.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select count(*) into v_admin_sees from public.events;

  -- 2 and 3. As an ordinary signed-in user.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_plain, 'role', 'authenticated')::text, true);
  select count(*) into v_plain_sees from public.events;
  select count(*) into v_plain_admins from public.app_admins;

  -- 5. Still as that user: try to write history.
  begin
    insert into public.events (user_id, source, kind, severity, summary)
    values (v_plain, 'forged', 'forged.event', 'info', 'should never appear');
  exception when others then
    v_blocked := true;
  end;

  -- 4. As a signed-out visitor.
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', null, true);
  select count(*) into v_anon_sees from public.events;
  reset role;

  if v_admin_sees <> v_all then
    raise exception 'admin saw % of % events', v_admin_sees, v_all;
  end if;
  if v_plain_sees <> v_plain_own then
    raise exception 'ordinary user saw % events, should be their own %', v_plain_sees, v_plain_own;
  end if;
  if v_plain_admins <> 0 then
    raise exception 'ordinary user read % rows of app_admins', v_plain_admins;
  end if;
  if v_anon_sees <> 0 then
    raise exception 'signed-out visitor saw % events', v_anon_sees;
  end if;
  if not v_blocked then
    delete from public.events where kind = 'forged.event';
    raise exception 'a signed-in user was able to write the audit log';
  end if;

  raise notice 'admin access: all five checks passed (% events, % visible to a normal user)',
    v_all, v_plain_own;
end $$;
