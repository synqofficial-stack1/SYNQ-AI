-- Synq places the calls itself.
--
-- The earlier sales_engine migration assumed a human dialled every number and
-- typed the outcome. That is not the product: the user asks for 20 local
-- businesses, Synq finds them, calls them with a voice agent, and writes back a
-- one-line note and a hot/warm/cold read per call.
--
-- This migration adds the columns that hold what the voice agent came back
-- with, and the attestation that must exist before any number is dialled.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Call results land on the prospect row
-- ---------------------------------------------------------------------------
--
-- One row per business = one row in the "spreadsheet" the user sees. The note
-- and temperature are written by the post-call webhook, never by hand and never
-- guessed by the planner model.

alter table public.prospects
  add column if not exists call_notes         text,
  add column if not exists temperature        text,
  add column if not exists transcript_summary text,
  add column if not exists conversation_id    text,
  add column if not exists provider_call_id   text,
  add column if not exists called_at          timestamptz,
  add column if not exists call_error         text;

do $$
begin
  alter table public.prospects
    add constraint prospects_temperature_check
    check (temperature is null or temperature in ('hot', 'warm', 'cold'));
exception
  when duplicate_object then null;
end $$;

-- Looking a prospect up by the provider's conversation id is the webhook's hot
-- path, so it gets an index rather than a scan.
create index if not exists prospects_conversation_idx
  on public.prospects (conversation_id)
  where conversation_id is not null;

-- 'dialing' covers the gap between handing a number to the provider and the
-- webhook coming back. Without it a call in flight looks identical to one that
-- was never attempted.
alter table public.prospects drop constraint if exists prospects_outreach_check;
alter table public.prospects
  add constraint prospects_outreach_check
  check (outreach_status in ('pending', 'dialing', 'called', 'skipped', 'failed'));

-- ---------------------------------------------------------------------------
-- 2. Attestation, and the statuses a run moves through
-- ---------------------------------------------------------------------------
--
-- Nothing is dialled until the user has seen the list and confirmed they have a
-- basis for calling it. `attested_at` is that confirmation; a run with a null
-- value here must never reach the provider. This is a checkpoint, not a
-- formality — it is the moment a person takes responsibility for the calls.

alter table public.sales_runs
  add column if not exists attested_at     timestamptz,
  add column if not exists calls_placed    integer not null default 0,
  add column if not exists provider        text,
  add column if not exists provider_batch_id text;

alter table public.sales_runs drop constraint if exists sales_runs_status_check;
alter table public.sales_runs
  add constraint sales_runs_status_check
  check (status in (
    'planning',           -- working out what was asked for
    'discovering',        -- searching the directory
    'screening',          -- eligibility gate
    'awaiting_approval',  -- list built, waiting for the user to confirm
    'calling',            -- calls are with the provider
    'completed',
    'blocked',            -- stopped for a reason the user can act on
    'failed'
  ));

-- `ready` existed before this migration and no longer does. Anything sitting in
-- it is waiting on exactly the confirmation the new status describes.
update public.sales_runs set status = 'awaiting_approval' where status = 'ready';
