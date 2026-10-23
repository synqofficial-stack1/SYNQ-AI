-- Recovered from production migration history on 2026-10-22 (applied live,
-- never committed).

-- Web calls started from Synq's browser client. The authenticated user creates
-- the session row; the signed Vapi webhook can only update that existing row.
create table if not exists public.vapi_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  assistant_id text not null,
  provider_call_id text unique,
  status text not null default 'starting'
    check (status in ('starting', 'in-progress', 'ended', 'failed')),
  transcript text,
  summary text,
  outcome text,
  error_message text,
  structured_output jsonb not null default '{}'::jsonb,
  ended_reason text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists vapi_calls_user_created_idx
  on public.vapi_calls (user_id, created_at desc);

alter table public.vapi_calls enable row level security;

grant select, insert, update on public.vapi_calls to authenticated;

create policy vapi_calls_select_own on public.vapi_calls
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy vapi_calls_insert_own on public.vapi_calls
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy vapi_calls_update_own on public.vapi_calls
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
