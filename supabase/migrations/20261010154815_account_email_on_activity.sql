-- Copy the owning Synq account email onto each user-owned row for easier
-- inspection in the Supabase table editor. `account_email` is distinct from
-- contact email fields such as leads.email and is always sourced from auth.users.

alter table public.profiles add column if not exists account_email text;

do $$
declare
  table_name text;
  user_tables text[] := array[
    'app_admins', 'calls', 'campaigns', 'company_facts', 'content_items',
    'conversations', 'departments', 'events', 'leads', 'messages',
    'oauth_states', 'onboarding_events', 'prospects', 'sales_runs',
    'social_connections', 'social_posts', 'tasks', 'user_onboarding_profiles', 'videos'
  ];
begin
  foreach table_name in array user_tables loop
    execute format('alter table public.%I add column if not exists account_email text', table_name);
    execute format(
      'update public.%I as row_data set account_email = auth_user.email from auth.users as auth_user where row_data.user_id = auth_user.id and row_data.account_email is distinct from auth_user.email',
      table_name
    );
    execute format(
      'comment on column public.%I.account_email is %L',
      table_name,
      'Owning Synq account email, synchronized from Supabase Auth. Distinct from customer/contact email fields.'
    );
  end loop;
end;
$$;

update public.profiles as profile
set account_email = auth_user.email
from auth.users as auth_user
where profile.id = auth_user.id
  and profile.account_email is distinct from auth_user.email;

comment on column public.profiles.account_email is
  'Owning Synq account email, synchronized from Supabase Auth.';

create or replace function public.fill_activity_account_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select auth_user.email into new.account_email
  from auth.users as auth_user
  where auth_user.id = new.user_id;
  return new;
end;
$$;

create or replace function public.fill_profile_account_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select auth_user.email into new.account_email
  from auth.users as auth_user
  where auth_user.id = new.id;
  return new;
end;
$$;

create or replace function public.sync_auth_email_to_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  table_name text;
  user_tables text[] := array[
    'app_admins', 'calls', 'campaigns', 'company_facts', 'content_items',
    'conversations', 'departments', 'events', 'leads', 'messages',
    'oauth_states', 'onboarding_events', 'prospects', 'sales_runs',
    'social_connections', 'social_posts', 'tasks', 'user_onboarding_profiles', 'videos'
  ];
begin
  if new.email is not distinct from old.email then
    return new;
  end if;

  update public.profiles
  set account_email = new.email
  where id = new.id and account_email is distinct from new.email;

  foreach table_name in array user_tables loop
    execute format(
      'update public.%I set account_email = $1 where user_id = $2 and account_email is distinct from $1',
      table_name
    ) using new.email, new.id;
  end loop;
  return new;
end;
$$;

revoke all on function public.fill_activity_account_email() from public, anon, authenticated;
revoke all on function public.fill_profile_account_email() from public, anon, authenticated;
revoke all on function public.sync_auth_email_to_activity() from public, anon, authenticated;

do $$
declare
  table_name text;
  user_tables text[] := array[
    'app_admins', 'calls', 'campaigns', 'company_facts', 'content_items',
    'conversations', 'departments', 'events', 'leads', 'messages',
    'oauth_states', 'onboarding_events', 'prospects', 'sales_runs',
    'social_connections', 'social_posts', 'tasks', 'user_onboarding_profiles', 'videos'
  ];
begin
  foreach table_name in array user_tables loop
    execute format('drop trigger if exists fill_account_email on public.%I', table_name);
    execute format(
      'create trigger fill_account_email before insert or update on public.%I for each row execute function public.fill_activity_account_email()',
      table_name
    );
  end loop;
end;
$$;

drop trigger if exists fill_profile_account_email on public.profiles;
create trigger fill_profile_account_email
before insert or update on public.profiles
for each row execute function public.fill_profile_account_email();

drop trigger if exists sync_auth_email_to_activity on auth.users;
create trigger sync_auth_email_to_activity
after update of email on auth.users
for each row execute function public.sync_auth_email_to_activity();
