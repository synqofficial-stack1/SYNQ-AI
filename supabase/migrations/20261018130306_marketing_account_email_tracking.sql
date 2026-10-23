-- Recovered from production migration history on 2026-10-22 (applied live,
-- never committed).

-- Keep the owning Synq account email visible on uploaded marketing activity,
-- matching the app's existing account_email convention on other user rows.
alter table public.marketing_media add column if not exists account_email text;
alter table public.marketing_post_drafts add column if not exists account_email text;

update public.marketing_media m set account_email = u.email
from auth.users u where u.id = m.user_id and m.account_email is distinct from u.email;
update public.marketing_post_drafts d set account_email = u.email
from auth.users u where u.id = d.user_id and d.account_email is distinct from u.email;

comment on column public.marketing_media.account_email is
  'Owning Synq account email, synchronized from Supabase Auth. Distinct from customer/contact email fields.';
comment on column public.marketing_post_drafts.account_email is
  'Owning Synq account email, synchronized from Supabase Auth. Distinct from customer/contact email fields.';

drop trigger if exists fill_account_email on public.marketing_media;
create trigger fill_account_email before insert or update on public.marketing_media
  for each row execute function public.fill_activity_account_email();
drop trigger if exists fill_account_email on public.marketing_post_drafts;
create trigger fill_account_email before insert or update on public.marketing_post_drafts
  for each row execute function public.fill_activity_account_email();

create or replace function public.sync_auth_email_to_marketing_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not distinct from old.email then return new; end if;
  update public.marketing_media set account_email = new.email
    where user_id = new.id and account_email is distinct from new.email;
  update public.marketing_post_drafts set account_email = new.email
    where user_id = new.id and account_email is distinct from new.email;
  return new;
end;
$$;
revoke all on function public.sync_auth_email_to_marketing_activity() from public, anon, authenticated;
drop trigger if exists sync_auth_email_to_marketing_activity on auth.users;
create trigger sync_auth_email_to_marketing_activity after update of email on auth.users
  for each row execute function public.sync_auth_email_to_marketing_activity();
