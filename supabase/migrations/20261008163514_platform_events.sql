-- Who may see the whole platform, and a record of what happens across it.
--
-- Two things did not exist before this migration:
--
--   1. **An owner.** Every table in Synq is scoped to one user by RLS, which is
--      right for the product and useless for whoever runs it. `app_admins`
--      names the accounts allowed to read across users. Nothing in the app can
--      write to it: a grant is a deliberate act by someone holding the
--      service-role key, which is why there is no insert policy below.
--   2. **A timeline.** Every table holds current state; none of them held a
--      history. `events` is that history, written by triggers on the tables
--      that already exist — so no application code has to remember to log, and
--      no existing behaviour changes.
--
-- The triggers never raise. If writing an event fails, the row that caused it
-- still commits: a broken audit trail must not stop a user finishing their
-- work. Every `exception when others then` below is there on purpose.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------------

create table if not exists public.app_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'admin'
               constraint app_admins_role_check check (role in ('ceo', 'admin')),
  -- Why this account has it, in words, for whoever reads the table in a year.
  note       text,
  granted_at timestamptz not null default now()
);

-- Reading the admin list from inside an RLS policy on that same table would
-- recurse, so this runs as owner and is the only way policies ask the question.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.app_admins a where a.user_id = uid);
$$;

revoke all on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated, service_role;

alter table public.app_admins enable row level security;

-- An admin may read the list (the console shows it). Nobody may write it from
-- a session of any kind — deliberately no insert, update or delete policy.
drop policy if exists app_admins_select_admin on public.app_admins;
create policy app_admins_select_admin on public.app_admins
  for select to authenticated using (public.is_admin((select auth.uid())));

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  -- The account it happened to. Null for platform-level events that belong to
  -- no single user.
  user_id    uuid references auth.users (id) on delete cascade,
  -- Which part of Synq produced it: tasks, videos, calls, sales_runs, auth…
  source     text not null,
  -- Dotted kind, e.g. 'task.failed', 'video.ready', 'admin.console_viewed'.
  kind       text not null,
  severity   text not null default 'info'
               constraint events_severity_check check (severity in ('info', 'warning', 'error')),
  -- One line, already written for a human. The console does not re-phrase it.
  summary    text not null,
  -- The row this is about, so the console can drill down.
  subject_id uuid,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The feed reads newest-first; the alerts panel reads newest-first among the
-- bad ones only, which is a small enough slice to deserve its own index.
create index if not exists events_recent_idx on public.events (created_at desc);
create index if not exists events_trouble_idx on public.events (created_at desc)
  where severity <> 'info';
create index if not exists events_user_idx on public.events (user_id, created_at desc);
create index if not exists events_kind_idx on public.events (kind, created_at desc);

alter table public.events enable row level security;

-- A user sees their own history; an admin sees all of it. Writes come from the
-- triggers below (security definer) and the service role, never from a client.
drop policy if exists events_select_own on public.events;
create policy events_select_own on public.events
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists events_select_admin on public.events;
create policy events_select_admin on public.events
  for select to authenticated using (public.is_admin((select auth.uid())));

-- ---------------------------------------------------------------------------
-- The writer
-- ---------------------------------------------------------------------------

create or replace function public.log_event(
  p_user     uuid,
  p_source   text,
  p_kind     text,
  p_severity text,
  p_summary  text,
  p_subject  uuid default null,
  p_meta     jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.events (user_id, source, kind, severity, summary, subject_id, meta)
  values (
    p_user,
    p_source,
    p_kind,
    p_severity,
    -- A summary is a line in a feed, not a document.
    left(coalesce(nullif(trim(p_summary), ''), p_kind), 300),
    p_subject,
    coalesce(p_meta, '{}'::jsonb)
  );
exception when others then
  -- Logging is never worth failing a user's write for.
  null;
end;
$$;

revoke all on function public.log_event(uuid, text, text, text, text, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers on the tables that already exist
-- ---------------------------------------------------------------------------

create or replace function public.events_from_tasks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_event(new.user_id, 'tasks', 'task.created', 'info',
      'Task started: ' || replace(new.task_type, '_', ' '), new.id,
      jsonb_build_object('task_type', new.task_type, 'status', new.status));
  elsif new.status is distinct from old.status then
    perform public.log_event(new.user_id, 'tasks', 'task.' || new.status,
      case when new.status = 'failed' then 'error' else 'info' end,
      'Task ' || new.status || ': ' || replace(new.task_type, '_', ' '), new.id,
      jsonb_build_object('task_type', new.task_type, 'status', new.status));
  end if;
  return null;
exception when others then
  return null;
end;
$$;

drop trigger if exists tasks_emit_events on public.tasks;
create trigger tasks_emit_events after insert or update on public.tasks
  for each row execute function public.events_from_tasks();

create or replace function public.events_from_videos()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_event(new.user_id, 'videos', 'video.requested', 'info',
      'Video requested (' || new.duration_seconds || 's, ' || new.resolution || ')', new.id,
      jsonb_build_object('status', new.status, 'resolution', new.resolution));
  elsif new.status is distinct from old.status then
    perform public.log_event(new.user_id, 'videos', 'video.' || new.status,
      case when new.status = 'failed' then 'error' else 'info' end,
      case
        when new.status = 'failed' then 'Video generation failed: ' || coalesce(new.error, 'no reason given')
        when new.status = 'ready' then 'Video ready'
        else 'Video ' || new.status
      end,
      new.id,
      jsonb_build_object('status', new.status, 'error', new.error));
  end if;
  return null;
exception when others then
  return null;
end;
$$;

drop trigger if exists videos_emit_events on public.videos;
create trigger videos_emit_events after insert or update on public.videos
  for each row execute function public.events_from_videos();

create or replace function public.events_from_calls()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.log_event(new.user_id, 'calls', 'call.logged',
    case when new.outcome in ('wrong_number', 'no_answer') then 'warning' else 'info' end,
    'Call logged: ' || replace(new.outcome, '_', ' '), new.id,
    jsonb_build_object('outcome', new.outcome, 'lead_id', new.lead_id));
  return null;
exception when others then
  return null;
end;
$$;

drop trigger if exists calls_emit_events on public.calls;
create trigger calls_emit_events after insert on public.calls
  for each row execute function public.events_from_calls();

create or replace function public.events_from_leads()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.log_event(new.user_id, 'leads', 'lead.created', 'info',
    'Lead added: ' || coalesce(nullif(new.name, ''), coalesce(new.company, 'unnamed')), new.id,
    jsonb_build_object('source', new.source, 'status', new.status));
  return null;
exception when others then
  return null;
end;
$$;

drop trigger if exists leads_emit_events on public.leads;
create trigger leads_emit_events after insert on public.leads
  for each row execute function public.events_from_leads();

create or replace function public.events_from_sales_runs()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_event(new.user_id, 'sales_runs', 'run.created', 'info',
      'Sales run created', new.id, jsonb_build_object('status', new.status, 'source', new.source));
  elsif new.status is distinct from old.status then
    perform public.log_event(new.user_id, 'sales_runs', 'run.' || new.status,
      case
        when new.status = 'failed' then 'error'
        when new.status = 'blocked' then 'warning'
        else 'info'
      end,
      case
        when new.blocked_reason is not null then 'Sales run ' || new.status || ': ' || new.blocked_reason
        else 'Sales run ' || new.status
      end,
      new.id,
      jsonb_build_object('status', new.status, 'calls_placed', new.calls_placed));
  end if;
  return null;
exception when others then
  return null;
end;
$$;

drop trigger if exists sales_runs_emit_events on public.sales_runs;
create trigger sales_runs_emit_events after insert or update on public.sales_runs
  for each row execute function public.events_from_sales_runs();

-- Prospects are where a call actually succeeds or fails, so this is the row
-- that tells the console whether calling works at all.
create or replace function public.events_from_prospects()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.outreach_status is distinct from old.outreach_status
     and new.outreach_status in ('called', 'failed') then
    perform public.log_event(new.user_id, 'prospects', 'prospect.' || new.outreach_status,
      case when new.outreach_status = 'failed' then 'error' else 'info' end,
      case
        when new.outreach_status = 'failed'
          then 'Call failed for ' || new.name || ': ' || coalesce(new.call_error, 'no reason given')
        else 'Called ' || new.name || coalesce(' — ' || new.temperature, '')
      end,
      new.id,
      jsonb_build_object('temperature', new.temperature, 'error', new.call_error));
  end if;
  return null;
exception when others then
  return null;
end;
$$;

drop trigger if exists prospects_emit_events on public.prospects;
create trigger prospects_emit_events after update on public.prospects
  for each row execute function public.events_from_prospects();

create or replace function public.events_from_conversations()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.log_event(new.user_id, 'conversations', 'chat.started', 'info',
    'Chat started with ' || replace(new.kind, '_', ' '), new.id,
    jsonb_build_object('kind', new.kind));
  return null;
exception when others then
  return null;
end;
$$;

drop trigger if exists conversations_emit_events on public.conversations;
create trigger conversations_emit_events after insert on public.conversations
  for each row execute function public.events_from_conversations();

-- `profiles` gets its row from handle_new_user, so this is a sign-up event
-- without having to touch the auth schema or that trigger.
create or replace function public.events_from_profiles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.log_event(new.id, 'auth', 'user.signed_up', 'info',
    'New account created', new.id, '{}'::jsonb);
  return null;
exception when others then
  return null;
end;
$$;

drop trigger if exists profiles_emit_events on public.profiles;
create trigger profiles_emit_events after insert on public.profiles
  for each row execute function public.events_from_profiles();

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
--
-- The triggers only see what happens from now on, which would leave the feed
-- empty on the day it ships. These rows are reconstructed from the timestamps
-- already on the tables — real events, recorded late. They carry
-- `meta->>'backfilled' = 'true'` so the console can say so rather than imply
-- they were captured live.

do $$
begin
  if not exists (select 1 from public.events) then
    insert into public.events (user_id, source, kind, severity, summary, subject_id, meta, created_at)
    select t.user_id, 'tasks', 'task.' || t.status,
           case when t.status = 'failed' then 'error' else 'info' end,
           'Task ' || t.status || ': ' || replace(t.task_type, '_', ' '), t.id,
           jsonb_build_object('task_type', t.task_type, 'status', t.status, 'backfilled', true),
           coalesce(t.completed_at, t.created_at)
    from public.tasks t;

    insert into public.events (user_id, source, kind, severity, summary, subject_id, meta, created_at)
    select v.user_id, 'videos', 'video.' || v.status,
           case when v.status = 'failed' then 'error' else 'info' end,
           case when v.status = 'failed'
                then 'Video generation failed: ' || coalesce(v.error, 'no reason given')
                else 'Video ' || v.status end,
           v.id,
           jsonb_build_object('status', v.status, 'error', v.error, 'backfilled', true),
           v.updated_at
    from public.videos v;

    insert into public.events (user_id, source, kind, severity, summary, subject_id, meta, created_at)
    select l.user_id, 'leads', 'lead.created', 'info',
           'Lead added: ' || coalesce(nullif(l.name, ''), coalesce(l.company, 'unnamed')), l.id,
           jsonb_build_object('source', l.source, 'status', l.status, 'backfilled', true),
           l.created_at
    from public.leads l;

    insert into public.events (user_id, source, kind, severity, summary, subject_id, meta, created_at)
    select c.user_id, 'calls', 'call.logged',
           case when c.outcome in ('wrong_number', 'no_answer') then 'warning' else 'info' end,
           'Call logged: ' || replace(c.outcome, '_', ' '), c.id,
           jsonb_build_object('outcome', c.outcome, 'backfilled', true),
           c.created_at
    from public.calls c;

    insert into public.events (user_id, source, kind, severity, summary, subject_id, meta, created_at)
    select r.user_id, 'sales_runs', 'run.' || r.status,
           case when r.status = 'failed' then 'error'
                when r.status = 'blocked' then 'warning' else 'info' end,
           case when r.blocked_reason is not null
                then 'Sales run ' || r.status || ': ' || r.blocked_reason
                else 'Sales run ' || r.status end,
           r.id,
           jsonb_build_object('status', r.status, 'backfilled', true),
           r.updated_at
    from public.sales_runs r;

    insert into public.events (user_id, source, kind, severity, summary, subject_id, meta, created_at)
    select cv.user_id, 'conversations', 'chat.started', 'info',
           'Chat started with ' || replace(cv.kind, '_', ' '), cv.id,
           jsonb_build_object('kind', cv.kind, 'backfilled', true),
           cv.created_at
    from public.conversations cv;

    insert into public.events (user_id, source, kind, severity, summary, subject_id, meta, created_at)
    select p.id, 'auth', 'user.signed_up', 'info', 'New account created', p.id,
           jsonb_build_object('backfilled', true), p.created_at
    from public.profiles p;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The first admin
-- ---------------------------------------------------------------------------
--
-- Seeded by email rather than id so this migration is readable and so it does
-- nothing on a database where that account does not exist. To grant someone
-- else, insert them here with the service-role key; to revoke, delete the row.

insert into public.app_admins (user_id, role, note)
select id, 'ceo', 'Account owner'
from auth.users
where email = 'synq.ai.official@gmail.com'
on conflict (user_id) do nothing;
