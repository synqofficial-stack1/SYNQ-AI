begin;
alter table public.profiles add column full_name text check (length(full_name) between 1 and 100);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(name) between 2 and 120),
  name_key text generated always as (lower(regexp_replace(trim(name),'\s+',' ','g'))) stored unique,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.organization_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  role text not null check(role in ('owner','member')),
  status text not null check(status in ('active','pending','rejected','removed')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  check(role <> 'owner' or status='active')
);
create index organization_members_company on public.organization_members(organization_id,status);
create unique index organization_one_owner on public.organization_members(organization_id) where role='owner';
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
revoke all on public.organizations,public.organization_members from anon,authenticated;
grant select on public.organizations,public.organization_members to authenticated;
grant all on public.organizations,public.organization_members to service_role;

create function public.current_organization() returns uuid
language sql stable security definer set search_path='' as $$
  select organization_id from public.organization_members where user_id=auth.uid() and status='active';
$$;
create function public.owns_organization(p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.organizations o join public.organization_members m on m.user_id=o.owner_id and m.organization_id=o.id
    where o.id=p_org and o.owner_id=auth.uid() and m.role='owner' and m.status='active');
$$;
revoke all on function public.current_organization(),public.owns_organization(uuid) from public,anon;
grant execute on function public.current_organization(),public.owns_organization(uuid) to authenticated,service_role;
create policy company_visible on public.organizations for select to authenticated using (
  exists(select 1 from public.organization_members m where m.user_id=auth.uid() and m.organization_id=id)
);
create policy member_visible on public.organization_members for select to authenticated using (
  user_id=auth.uid() or public.owns_organization(organization_id)
);

alter table public.leads add column organization_id uuid references public.organizations(id);
alter table public.outreach_campaigns add column organization_id uuid references public.organizations(id);
create index leads_organization on public.leads(organization_id);
create index outreach_campaigns_organization on public.outreach_campaigns(organization_id);

-- Stamp assets from the creator's approved membership. Callers cannot choose a
-- company in an insert. Organization IDs remain stable after membership ends.
create function public.assign_asset_organization() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.organization_members where user_id=new.user_id and status='active';
  if new.organization_id is not null and new.organization_id is distinct from v_org then raise exception 'Company access denied'; end if;
  new.organization_id:=v_org;
  return new;
end; $$;
revoke all on function public.assign_asset_organization() from public,anon,authenticated;
create trigger leads_company before insert on public.leads for each row execute function public.assign_asset_organization();
create trigger outreach_company before insert on public.outreach_campaigns for each row execute function public.assign_asset_organization();

drop policy leads_select_own on public.leads;
drop policy leads_insert_own on public.leads;
drop policy leads_update_own on public.leads;
drop policy leads_delete_own on public.leads;
create policy leads_select_workspace on public.leads for select to authenticated using (
  case when organization_id is null then user_id=auth.uid() else organization_id=public.current_organization() end
);
create policy leads_insert_workspace on public.leads for insert to authenticated with check (
  user_id=auth.uid() and organization_id is not distinct from public.current_organization()
);
create policy leads_update_workspace on public.leads for update to authenticated using (
  case when organization_id is null then user_id=auth.uid() else organization_id=public.current_organization() end
) with check (case when organization_id is null then user_id=auth.uid() else organization_id=public.current_organization() end);
create policy leads_delete_workspace on public.leads for delete to authenticated using (
  (organization_id is null and user_id=auth.uid()) or (organization_id=public.current_organization() and (user_id=auth.uid() or public.owns_organization(organization_id)))
);
-- A teammate may edit contact details, but cannot change authorship or tenant.
revoke update on public.leads from authenticated;
grant update(name,phone,email,company,notes,status) on public.leads to authenticated;

drop policy outreach_campaign_owner on public.outreach_campaigns;
drop policy outreach_recipient_owner on public.outreach_recipients;
drop policy outreach_message_owner on public.outreach_messages;
create policy outreach_campaign_workspace on public.outreach_campaigns for select to authenticated using (
  case when organization_id is null then user_id=auth.uid() else organization_id=public.current_organization() end
);
create policy outreach_recipient_workspace on public.outreach_recipients for select to authenticated using (
  exists(select 1 from public.outreach_campaigns c where c.id=campaign_id)
);
create policy outreach_message_workspace on public.outreach_messages for select to authenticated using (
  exists(select 1 from public.outreach_recipients r where r.id=recipient_id)
);

create function public.workspace_identity() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_name text; v_membership jsonb;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  select full_name into v_name from public.profiles where id=v_user;
  select jsonb_build_object('organization_id',o.id,'company_name',o.name,'role',m.role,'status',m.status,
    'pending_count',case when m.role='owner' then (select count(*) from public.organization_members pending where pending.organization_id=o.id and pending.status='pending') else 0 end)
    into v_membership from public.organization_members m join public.organizations o on o.id=m.organization_id where m.user_id=v_user;
  return jsonb_build_object('full_name',v_name,'membership',v_membership);
end; $$;

-- This function is the only self-service entry into a company. Claiming to be
-- an owner of an existing company still creates only a pending member request.
create function public.setup_workspace(p_name text,p_company text,p_owner boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_org uuid; v_owned boolean:=false; v_current public.organization_members%rowtype;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 100 or p_name~'[[:cntrl:]]' then raise exception 'Enter your name (up to 100 characters)'; end if;
  if p_company is null or length(trim(p_company)) not between 2 and 120 or p_company~'[[:cntrl:]]' then raise exception 'Enter the company name (2–120 characters)'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text,0));
  select * into v_current from public.organization_members where user_id=v_user;
  if v_current.status='active' then
    update public.profiles set full_name=trim(p_name) where id=v_user;
    return public.workspace_identity();
  end if;
  select id into v_org from public.organizations where name_key=lower(regexp_replace(trim(p_company),'\s+',' ','g'));
  if v_org is null then
    if p_owner is not true then raise exception 'This company is not registered. Ask its owner to create the workspace first.'; end if;
    insert into public.organizations(name,owner_id) values(trim(p_company),v_user) on conflict(name_key) do nothing returning id into v_org;
    v_owned:=v_org is not null;
    if v_org is null then select id into v_org from public.organizations where name_key=lower(regexp_replace(trim(p_company),'\s+',' ','g')); end if;
  end if;
  insert into public.profiles(id,full_name) values(v_user,trim(p_name)) on conflict(id) do update set full_name=excluded.full_name;
  insert into public.organization_members(user_id,organization_id,role,status)
    values(v_user,v_org,case when v_owned then 'owner' else 'member' end,case when v_owned then 'active' else 'pending' end)
    on conflict(user_id) do update set organization_id=excluded.organization_id,role=excluded.role,status=excluded.status,requested_at=now(),reviewed_at=null,reviewed_by=null;
  if v_owned then
    update public.leads set organization_id=v_org where user_id=v_user and organization_id is null;
    update public.outreach_campaigns set organization_id=v_org where user_id=v_user and organization_id is null;
  end if;
  return public.workspace_identity();
end; $$;

create function public.organization_people() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_org uuid:=public.current_organization(); v_result jsonb;
begin
  if v_org is null or not public.owns_organization(v_org) then raise exception 'Only the company owner can manage users'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',p.full_name,'email',u.email,'role',m.role,'status',m.status,'requested_at',m.requested_at) order by m.requested_at),'[]'::jsonb)
    into v_result from public.organization_members m join auth.users u on u.id=m.user_id left join public.profiles p on p.id=m.user_id where m.organization_id=v_org;
  return v_result;
end; $$;

create function public.review_organization_member(p_user uuid,p_decision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.current_organization(); v_member public.organization_members%rowtype;
begin
  if v_org is null or not public.owns_organization(v_org) then raise exception 'Only the company owner can approve users'; end if;
  if p_user=auth.uid() then raise exception 'You cannot remove or approve your own owner account'; end if;
  if p_decision not in ('approve','reject','remove') then raise exception 'Unknown decision'; end if;
  select * into v_member from public.organization_members where user_id=p_user and organization_id=v_org for update;
  if not found or v_member.role='owner' then raise exception 'Request not found'; end if;
  if (p_decision in ('approve','reject') and v_member.status<>'pending') or (p_decision='remove' and v_member.status<>'active') then raise exception 'This request has already changed. Refresh the list.'; end if;
  update public.organization_members set status=case p_decision when 'approve' then 'active' when 'reject' then 'rejected' else 'removed' end,reviewed_at=now(),reviewed_by=auth.uid() where user_id=p_user;
  if p_decision='approve' then
    update public.leads set organization_id=v_org where user_id=p_user and organization_id is null;
    update public.outreach_campaigns set organization_id=v_org where user_id=p_user and organization_id is null;
  else
    update public.outreach_campaigns set status='paused' where user_id=p_user and organization_id=v_org and status='active';
  end if;
  return jsonb_build_object('updated',true);
end; $$;
revoke all on function public.workspace_identity(),public.setup_workspace(text,text,boolean),public.organization_people(),public.review_organization_member(uuid,text) from public,anon;
grant execute on function public.workspace_identity(),public.setup_workspace(text,text,boolean),public.organization_people(),public.review_organization_member(uuid,text) to authenticated;
commit;
