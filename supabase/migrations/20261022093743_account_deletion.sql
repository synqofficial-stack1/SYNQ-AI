-- Account deletion: Settings -> Delete account, and the web deletion page that
-- Google Play requires. The delete-account Edge Function is the only caller.
--
-- Deleting an auth user must never be blocked by a reference left behind, so
-- the last references without a delete rule get one here. A workspace is only
-- removed when its owner is its last active member (checked below), so its
-- shared records go with it.

alter table public.organization_members
  drop constraint organization_members_reviewed_by_fkey,
  add constraint organization_members_reviewed_by_fkey
    foreign key (reviewed_by) references auth.users(id) on delete set null;
alter table public.sales_deals
  drop constraint sales_deals_user_id_fkey,
  add constraint sales_deals_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.leads
  drop constraint leads_organization_id_fkey,
  add constraint leads_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.organization_members
  drop constraint organization_members_organization_id_fkey,
  add constraint organization_members_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.outreach_campaigns
  drop constraint outreach_campaigns_organization_id_fkey,
  add constraint outreach_campaigns_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.sales_deals
  drop constraint sales_deals_organization_id_fkey,
  add constraint sales_deals_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.sales_targets
  drop constraint sales_targets_organization_id_fkey,
  add constraint sales_targets_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;

-- Workspaces this user owns that still have other active members. There is no
-- ownership transfer yet, so deleting the owner would silently take a shared
-- CRM away from the rest of the team; the owner removes them first instead.
create or replace function public.account_deletion_blockers(p_user uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(o.name order by o.name), '{}')
  from public.organizations o
  where o.owner_id = p_user and exists (
    select 1 from public.organization_members m
    where m.organization_id = o.id and m.user_id <> p_user and m.status = 'active'
  );
$$;

-- Every file a user owns lives under a folder named with their id. Storage rows
-- cannot be deleted with SQL, so the Edge Function removes these through the
-- Storage API before it deletes the account.
create or replace function public.account_storage_objects(p_user uuid)
returns table(bucket_id text, name text) language sql stable security definer set search_path = '' as $$
  select o.bucket_id, o.name from storage.objects o
  where (storage.foldername(o.name))[1] = p_user::text;
$$;

-- One transaction: the user's own workspaces, then the account. Every other row
-- that belongs to the user cascades from auth.users.
create or replace function public.delete_account(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then raise exception 'No account to delete.'; end if;
  if cardinality(public.account_deletion_blockers(p_user)) > 0 then
    raise exception 'ACCOUNT_DELETION_BLOCKED';
  end if;
  delete from public.organizations where owner_id = p_user;
  delete from auth.users where id = p_user;
  if not found then raise exception 'Account not found.'; end if;
  -- No id, email or name: the console shows that a deletion happened, nothing more.
  insert into public.events(user_id, source, kind, severity, summary)
    values (null, 'account', 'account.deleted', 'info', 'An account was deleted at its owner''s request.');
end;
$$;

revoke all on function public.account_deletion_blockers(uuid), public.account_storage_objects(uuid), public.delete_account(uuid)
  from public, anon, authenticated;
grant execute on function public.account_deletion_blockers(uuid), public.account_storage_objects(uuid), public.delete_account(uuid)
  to service_role;
