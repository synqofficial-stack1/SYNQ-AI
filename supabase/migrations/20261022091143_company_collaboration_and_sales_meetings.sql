begin;

create table if not exists public.organization_chat_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists organization_chat_recent_idx
  on public.organization_chat_messages(organization_id, created_at desc, id desc);
alter table public.organization_chat_messages enable row level security;
revoke all on public.organization_chat_messages from anon, authenticated;
grant select, insert on public.organization_chat_messages to authenticated;
create policy organization_chat_read on public.organization_chat_messages for select to authenticated
  using (organization_id = public.current_organization());
create policy organization_chat_send on public.organization_chat_messages for insert to authenticated
  with check (organization_id = public.current_organization() and sender_id = auth.uid());

create table if not exists public.organization_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  assigned_to uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 160),
  details text not null default '' check (length(details) <= 3000),
  status text not null default 'open' check (status in ('open','in_progress','completed')),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists organization_tasks_assigned_idx
  on public.organization_tasks(organization_id, assigned_to, status, due_at);
drop trigger if exists organization_tasks_touch_updated_at on public.organization_tasks;
create trigger organization_tasks_touch_updated_at before update on public.organization_tasks
  for each row execute function public.touch_updated_at();
alter table public.organization_tasks enable row level security;
revoke all on public.organization_tasks from anon, authenticated;
grant select, insert on public.organization_tasks to authenticated;
grant update(assigned_to, title, details, status, due_at) on public.organization_tasks to authenticated;
create policy organization_tasks_read on public.organization_tasks for select to authenticated
  using (organization_id = public.current_organization());
create policy organization_tasks_create on public.organization_tasks for insert to authenticated
  with check (created_by = auth.uid() and organization_id = public.current_organization() and exists (
    select 1 from public.organization_members m where m.organization_id = organization_tasks.organization_id
      and m.user_id = assigned_to and m.status = 'active'
  ));
-- Everyone in the workspace can read the board, but only the people a task
-- involves (its creator and assignee) or the workspace owner may change it,
-- the same rule sales meetings use.
create policy organization_tasks_edit on public.organization_tasks for update to authenticated
  using (
    organization_id = public.current_organization()
    and (created_by = auth.uid() or assigned_to = auth.uid() or public.owns_organization(organization_id))
  ) with check (
    organization_id = public.current_organization()
    and (created_by = auth.uid() or assigned_to = auth.uid() or public.owns_organization(organization_id))
    and exists (select 1 from public.organization_members m where m.organization_id = organization_tasks.organization_id and m.user_id = assigned_to and m.status = 'active')
  );

create table if not exists public.sales_meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  organizer_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '' check (length(description) <= 3000),
  starts_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_meetings_org_start_idx on public.sales_meetings(organization_id, starts_at);
create table if not exists public.sales_meeting_attendees (
  meeting_id uuid not null references public.sales_meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);
create index if not exists sales_meeting_attendees_user_idx on public.sales_meeting_attendees(user_id, meeting_id);
alter table public.sales_meetings enable row level security;
alter table public.sales_meeting_attendees enable row level security;
revoke all on public.sales_meetings, public.sales_meeting_attendees from anon, authenticated;
grant select on public.sales_meetings, public.sales_meeting_attendees to authenticated;

create or replace function public.can_access_sales_meeting(p_meeting uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sales_meetings m where m.id = p_meeting
      and m.organization_id = public.current_organization()
      and (m.organizer_id = auth.uid() or exists (
        select 1 from public.sales_meeting_attendees a where a.meeting_id = m.id and a.user_id = auth.uid()
      ))
  );
$$;
create or replace function public.can_manage_sales_meeting(p_meeting uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sales_meetings m where m.id = p_meeting
      and m.organization_id = public.current_organization()
      and (m.organizer_id = auth.uid() or public.owns_organization(m.organization_id))
  );
$$;
revoke all on function public.can_access_sales_meeting(uuid), public.can_manage_sales_meeting(uuid) from public, anon;
grant execute on function public.can_access_sales_meeting(uuid), public.can_manage_sales_meeting(uuid) to authenticated;

create policy sales_meetings_read on public.sales_meetings for select to authenticated
  using (public.can_access_sales_meeting(id));
create policy sales_meetings_create on public.sales_meetings for insert to authenticated
  with check (organizer_id = auth.uid() and organization_id = public.current_organization());
create policy sales_meetings_edit on public.sales_meetings for update to authenticated
  using (public.can_manage_sales_meeting(id)) with check (public.can_manage_sales_meeting(id));
create policy meeting_attendees_read on public.sales_meeting_attendees for select to authenticated
  using (public.can_access_sales_meeting(meeting_id));
create policy meeting_attendees_add on public.sales_meeting_attendees for insert to authenticated
  with check (public.can_manage_sales_meeting(meeting_id) and exists (
    select 1 from public.organization_members om join public.sales_meetings m on m.organization_id = om.organization_id
    where m.id = meeting_id and om.user_id = sales_meeting_attendees.user_id and om.status = 'active'
  ));
create policy meeting_attendees_remove on public.sales_meeting_attendees for delete to authenticated
  using (public.can_manage_sales_meeting(meeting_id));

create or replace function public.organization_active_members()
returns table(user_id uuid, display_name text, is_current_user boolean)
language sql stable security definer set search_path = '' as $$
  select m.user_id, coalesce(nullif(btrim(p.full_name), ''), 'Team member'), m.user_id = auth.uid()
  from public.organization_members m left join public.profiles p on p.id = m.user_id
  where m.organization_id = public.current_organization() and m.status = 'active'
  order by m.user_id = auth.uid() desc, coalesce(nullif(btrim(p.full_name), ''), 'Team member');
$$;
revoke all on function public.organization_active_members() from public, anon;
grant execute on function public.organization_active_members() to authenticated;

create or replace function public.create_sales_meeting(p_request_id uuid, p_title text, p_starts_at timestamptz, p_description text, p_attendees uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_org uuid := public.current_organization(); v_id uuid;
begin
  if v_user is null or v_org is null then raise exception 'Approved workspace access is required.'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 160 then raise exception 'Enter a meeting title (up to 160 characters).'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'Choose a meeting time in the future.'; end if;
  if length(coalesce(p_description,'')) > 3000 then raise exception 'Meeting details must be 3,000 characters or less.'; end if;
  if coalesce(cardinality(p_attendees),0) > 50 then raise exception 'Choose no more than 50 attendees.'; end if;
  if exists (select 1 from unnest(coalesce(p_attendees,'{}'::uuid[])) u group by u having count(*) > 1) then raise exception 'An attendee was selected more than once.'; end if;
  if exists (select 1 from unnest(coalesce(p_attendees,'{}'::uuid[])) u where not exists (
    select 1 from public.organization_members m where m.organization_id = v_org and m.user_id = u and m.status = 'active'
  )) then raise exception 'Every attendee must be an active company member.'; end if;
  select id into v_id from public.sales_meetings where id = p_request_id and organization_id = v_org and organizer_id = v_user;
  if v_id is not null then
    if not exists (select 1 from public.sales_meetings where id = v_id and title = btrim(p_title)
      and description = coalesce(p_description,'') and starts_at = p_starts_at) then
      raise exception 'This meeting request ID was already used for different meeting details.';
    end if;
    return v_id;
  end if;
  insert into public.sales_meetings(id, organization_id, organizer_id, title, description, starts_at)
    values (p_request_id, v_org, v_user, btrim(p_title), coalesce(p_description,''), p_starts_at) returning id into v_id;
  insert into public.sales_meeting_attendees(meeting_id,user_id)
    select v_id,u from unnest(coalesce(p_attendees,'{}'::uuid[])) u where u <> v_user on conflict do nothing;
  return v_id;
end;
$$;

create or replace function public.update_sales_meeting_attendees(p_meeting uuid, p_attendees uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.current_organization();
begin
  if not public.can_manage_sales_meeting(p_meeting) then raise exception 'Only the organizer or workspace owner can change attendees.'; end if;
  if coalesce(cardinality(p_attendees),0) > 50 then raise exception 'Choose no more than 50 attendees.'; end if;
  if exists (select 1 from unnest(coalesce(p_attendees,'{}'::uuid[])) u group by u having count(*) > 1) then raise exception 'An attendee was selected more than once.'; end if;
  if exists (select 1 from unnest(coalesce(p_attendees,'{}'::uuid[])) u where not exists (
    select 1 from public.organization_members m where m.organization_id = v_org and m.user_id = u and m.status = 'active'
  )) then raise exception 'Every attendee must be an active company member.'; end if;
  delete from public.sales_meeting_attendees where meeting_id = p_meeting;
  insert into public.sales_meeting_attendees(meeting_id,user_id)
    select p_meeting,u from unnest(coalesce(p_attendees,'{}'::uuid[])) u
    where u <> (select organizer_id from public.sales_meetings where id = p_meeting) on conflict do nothing;
end;
$$;
revoke all on function public.create_sales_meeting(uuid,text,timestamptz,text,uuid[]), public.update_sales_meeting_attendees(uuid,uuid[]) from public, anon;
grant execute on function public.create_sales_meeting(uuid,text,timestamptz,text,uuid[]), public.update_sales_meeting_attendees(uuid,uuid[]) to authenticated;

commit;
