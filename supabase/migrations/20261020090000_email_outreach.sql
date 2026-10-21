begin;

create table public.outreach_mailboxes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  refresh_token text not null,
  connected_at timestamptz not null default now()
);
create table public.outreach_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  return_url text not null,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create table public.outreach_suppressions (
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  primary key(user_id,email)
);
alter table public.outreach_suppressions enable row level security;
revoke all on public.outreach_suppressions from anon,authenticated;
grant all on public.outreach_suppressions to service_role;
create table public.outreach_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  goal text not null check (length(goal) between 1 and 2000),
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) between 0 and 12),
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 12000),
  sender_email text,
  status text not null default 'draft' check (status in ('draft','active','paused','completed')),
  report jsonb,
  report_at timestamptz,
  sync_error text,
  last_synced_at timestamptz,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.outreach_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  email text not null check (email = lower(email) and length(email) <= 254),
  name text not null default '' check (length(name) <= 100),
  status text not null default 'queued' check (status in ('queued','sending','sent','replied','failed','uncertain')),
  outbound_message_id text,
  gmail_message_id text,
  thread_id text,
  sent_at timestamptz,
  last_reply_at timestamptz,
  last_checked_at timestamptz,
  error text,
  analysis jsonb,
  analysis_message_count integer not null default 0,
  analysis_error text,
  unique (campaign_id,email)
);
create table public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.outreach_recipients(id) on delete cascade,
  gmail_message_id text not null,
  sender text not null,
  body text not null,
  received_at timestamptz not null,
  is_auto_reply boolean not null default false,
  unique (recipient_id,gmail_message_id)
);
create index outreach_campaigns_owner on public.outreach_campaigns(user_id,created_at desc);
create index outreach_recipients_campaign on public.outreach_recipients(campaign_id);
create index outreach_messages_recipient on public.outreach_messages(recipient_id,received_at);
alter table public.outreach_mailboxes enable row level security;
alter table public.outreach_oauth_states enable row level security;
alter table public.outreach_campaigns enable row level security;
alter table public.outreach_recipients enable row level security;
alter table public.outreach_messages enable row level security;
revoke all on public.outreach_mailboxes, public.outreach_oauth_states from anon, authenticated;
revoke all on public.outreach_campaigns, public.outreach_recipients, public.outreach_messages from anon, authenticated;
grant select on public.outreach_campaigns, public.outreach_recipients, public.outreach_messages to authenticated;
grant all on public.outreach_mailboxes, public.outreach_oauth_states, public.outreach_campaigns, public.outreach_recipients, public.outreach_messages to service_role;
create policy outreach_campaign_owner on public.outreach_campaigns for select to authenticated using (user_id = (select auth.uid()));
create policy outreach_recipient_owner on public.outreach_recipients for select to authenticated using (
  exists(select 1 from public.outreach_campaigns c where c.id = campaign_id and c.user_id = (select auth.uid()))
);
create policy outreach_message_owner on public.outreach_messages for select to authenticated using (
  exists(select 1 from public.outreach_recipients r join public.outreach_campaigns c on c.id = r.campaign_id where r.id = recipient_id and c.user_id = (select auth.uid()))
);

-- One transaction saves the draft and deduplicated recipients. Clients cannot
-- write a 'sent' status or change an approved message after sending starts.
create function public.create_outreach_campaign(p_user uuid, p_title text, p_goal text, p_questions jsonb, p_subject text, p_body text, p_recipients jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Server access required'; end if;
  if jsonb_array_length(p_recipients) not between 1 and 50 then raise exception 'Use 1 to 50 recipients'; end if;
  insert into public.outreach_campaigns(user_id,title,goal,questions,subject,body)
    values(p_user,p_title,p_goal,p_questions,p_subject,p_body) returning id into v_id;
  insert into public.outreach_recipients(campaign_id,email,name) select v_id, lower(trim(e->>'email')), coalesce(e->>'name','') from jsonb_array_elements(p_recipients) e on conflict do nothing;
  return v_id;
end; $$;

-- A database lease prevents background polling and a manual Sync from sending
-- the same campaign concurrently. 'sending' is never blindly resent.
create function public.claim_outreach_campaign(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Server access required'; end if;
  update public.outreach_campaigns set lease_until = now() + interval '4 minutes'
    where id = p_id and (lease_until is null or lease_until < now()) and status in ('active','completed');
  get diagnostics v_count = row_count;
  return v_count = 1;
end; $$;
revoke all on function public.create_outreach_campaign(uuid,text,text,jsonb,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.claim_outreach_campaign(uuid) from public,anon,authenticated;
grant execute on function public.create_outreach_campaign(uuid,text,text,jsonb,text,text,jsonb) to service_role;
grant execute on function public.claim_outreach_campaign(uuid) to service_role;
commit;
