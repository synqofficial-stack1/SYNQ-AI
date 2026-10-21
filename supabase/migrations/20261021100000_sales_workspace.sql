begin;
create table public.sales_deals (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 organization_id uuid not null references public.organizations(id),
 title text not null check(length(trim(title)) between 1 and 160),
 contact_name text not null default '' check(length(contact_name)<=120),
 contact_email text not null default '' check(length(contact_email)<=254),
 company text not null default '' check(length(company)<=120),
 stage text not null default 'new' check(stage in ('new','contacted','interested','negotiating','won','lost')),
 amount numeric(14,2) check(amount>=0),
 expected_close date,
 next_action text not null default '' check(length(next_action)<=500),
 next_action_on date,
 meeting_on date,
 meeting_time text not null default '' check(meeting_time='' or meeting_time~'^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 meeting_status text not null default 'planned' check(meeting_status in ('planned','held','no_show','cancelled')),
 meeting_notes text not null default '' check(length(meeting_notes)<=3000),
 lost_reason text not null default '' check(length(lost_reason)<=500),
 notes text not null default '' check(length(notes)<=5000),
 quote_text text not null default '' check(length(quote_text)<=12000),
 archived boolean not null default false,
 closed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(stage<>'lost' or length(trim(lost_reason))>0),
 check(next_action_on is null or length(trim(next_action))>0),
 check(meeting_on is not null or meeting_time='')
);
create index sales_deals_company_stage on public.sales_deals(organization_id,archived,stage);
create table public.sales_targets (
 organization_id uuid not null references public.organizations(id),
 month date not null check(extract(day from month)=1),
 revenue_goal numeric(14,2) not null check(revenue_goal>=0),
 deals_goal integer not null check(deals_goal>=0 and deals_goal<=1000000),
 updated_at timestamptz not null default now(),
 primary key(organization_id,month)
);
alter table public.sales_deals enable row level security;
alter table public.sales_targets enable row level security;
revoke all on public.sales_deals,public.sales_targets from anon,authenticated;
grant select,insert on public.sales_deals to authenticated;
grant update(title,contact_name,contact_email,company,stage,amount,expected_close,next_action,next_action_on,meeting_on,meeting_time,meeting_status,meeting_notes,lost_reason,notes,quote_text,archived) on public.sales_deals to authenticated;
grant select,insert on public.sales_targets to authenticated;
grant update(revenue_goal,deals_goal) on public.sales_targets to authenticated;
grant all on public.sales_deals,public.sales_targets to service_role;
create policy sales_deals_read on public.sales_deals for select to authenticated using(organization_id=public.current_organization());
create policy sales_deals_create on public.sales_deals for insert to authenticated with check(user_id=auth.uid() and organization_id=public.current_organization());
create policy sales_deals_edit on public.sales_deals for update to authenticated using(organization_id=public.current_organization()) with check(organization_id=public.current_organization());
create policy sales_targets_read on public.sales_targets for select to authenticated using(organization_id=public.current_organization());
create policy sales_targets_create on public.sales_targets for insert to authenticated with check(organization_id=public.current_organization() and public.owns_organization(organization_id));
create policy sales_targets_edit on public.sales_targets for update to authenticated using(public.owns_organization(organization_id)) with check(public.owns_organization(organization_id));
create trigger sales_deals_company before insert on public.sales_deals for each row execute function public.assign_asset_organization();
create function public.sales_deal_timestamps() returns trigger language plpgsql set search_path='' as $$
begin
 new.updated_at:=clock_timestamp();
 if new.stage in ('won','lost') then
  if tg_op='INSERT' then new.closed_at:=now();
  elsif old.stage is distinct from new.stage then new.closed_at:=now();
  else new.closed_at:=old.closed_at; end if;
 else new.closed_at:=null;end if;
 return new;
end;$$;
revoke all on function public.sales_deal_timestamps() from public,anon,authenticated;
create trigger sales_deal_dates before insert or update on public.sales_deals for each row execute function public.sales_deal_timestamps();
create function public.sales_target_timestamps() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at:=clock_timestamp();return new;end;$$;
revoke all on function public.sales_target_timestamps() from public,anon,authenticated;
create trigger sales_target_dates before update on public.sales_targets for each row execute function public.sales_target_timestamps();
commit;
