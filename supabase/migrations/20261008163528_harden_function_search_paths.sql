-- Keep every non-definer helper from inheriting a mutable search_path.
alter function public.touch_updated_at() set search_path = '';
alter function public.sales_agent_system_instructions() set search_path = '';
alter function public.marketing_agent_system_instructions() set search_path = '';
alter function public.assistant_system_instructions() set search_path = '';
alter function public.crm_agent_system_instructions() set search_path = '';

-- Admin checks are only needed inside RLS policies. Put the SECURITY DEFINER
-- helper outside PostgREST's exposed schemas and restrict it to the caller's
-- own id so it cannot be used as an account-enumeration RPC.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select uid = (select auth.uid())
    and exists (
      select 1
      from public.app_admins a
      where a.user_id = uid
    );
$$;

revoke all on function private.is_admin(uuid) from public, anon;
grant execute on function private.is_admin(uuid) to authenticated, service_role;

drop policy if exists app_admins_select_admin on public.app_admins;
create policy app_admins_select_admin on public.app_admins
  for select to authenticated
  using (private.is_admin((select auth.uid())));

drop policy if exists events_select_admin on public.events;
create policy events_select_admin on public.events
  for select to authenticated
  using (private.is_admin((select auth.uid())));

drop function public.is_admin(uuid);
