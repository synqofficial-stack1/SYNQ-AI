-- Rollback-only proof for account deletion (migration 20261022093743).
-- Paste into the SQL editor. It raises on the first broken rule and always ends
-- in an exception, so nothing it creates survives.
do $$
declare
  owner_id uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); solo_id uuid := gen_random_uuid();
  team_org uuid; solo_org uuid; n integer; blocked text[];
begin
  insert into auth.users(id, email) values
    (owner_id, owner_id || '@example.invalid'), (member_id, member_id || '@example.invalid'), (solo_id, solo_id || '@example.invalid');
  insert into public.organizations(name, owner_id) values ('Deletion QA team ' || owner_id, owner_id) returning id into team_org;
  insert into public.organizations(name, owner_id) values ('Deletion QA solo ' || solo_id, solo_id) returning id into solo_org;
  insert into public.organization_members(user_id, organization_id, role, status, reviewed_by) values
    (owner_id, team_org, 'owner', 'active', null), (member_id, team_org, 'member', 'active', owner_id), (solo_id, solo_org, 'owner', 'active', null);
  insert into public.leads(user_id, organization_id, name) values (solo_id, solo_org, 'QA lead');

  -- 1. An owner whose workspace has another active member is refused, by name.
  blocked := public.account_deletion_blockers(owner_id);
  if cardinality(blocked) <> 1 then raise exception 'Owner with a teammate was not blocked'; end if;
  begin
    perform public.delete_account(owner_id);
    raise exception 'Blocked owner was deleted';
  exception when raise_exception then
    if SQLERRM <> 'ACCOUNT_DELETION_BLOCKED' then raise; end if;
  end;

  -- 2. A member can delete; the owner's review of them no longer blocks it.
  perform public.delete_account(member_id);
  select count(*) into n from auth.users where id = member_id;
  if n <> 0 then raise exception 'Member account still exists'; end if;

  -- 3. Now alone, the owner can delete, and their workspace goes with them.
  if cardinality(public.account_deletion_blockers(owner_id)) <> 0 then raise exception 'Sole owner still blocked'; end if;
  perform public.delete_account(owner_id);
  select count(*) into n from public.organizations where id = team_org;
  if n <> 0 then raise exception 'Owner workspace was left behind'; end if;

  -- 4. A sole owner's shared records cascade with the workspace.
  perform public.delete_account(solo_id);
  select count(*) into n from public.leads where organization_id = solo_org;
  if n <> 0 then raise exception 'Workspace leads were left behind'; end if;
  select count(*) into n from public.profiles where id = solo_id;
  if n <> 0 then raise exception 'Profile was left behind'; end if;

  -- 5. The console learns that deletions happened, and nothing about who.
  select count(*) into n from public.events where kind = 'account.deleted' and user_id is null and created_at > now() - interval '1 minute';
  if n < 3 then raise exception 'Deletion events were not recorded'; end if;

  -- 6. Signed-in users cannot call any of the three functions.
  if has_function_privilege('authenticated', 'public.delete_account(uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.account_storage_objects(uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.account_deletion_blockers(uuid)', 'execute') then
    raise exception 'A deletion function is callable by signed-in users';
  end if;

  raise exception 'ROLLBACK_SENTINEL: account deletion checks passed';
end $$;
