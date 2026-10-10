-- Cold calling: one row per call attempt.
--
-- Outcomes live here rather than on `leads` because a lead can be called more
-- than once, and the earlier attempts are the useful part — "no answer twice,
-- then call back" is a different situation from "no answer once".
--
-- Safe to re-run.

create table if not exists public.calls (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  lead_id    uuid not null references public.leads (id) on delete cascade,
  outcome    text not null
               constraint calls_outcome_check
               check (outcome in (
                 'interested', 'not_interested', 'call_back',
                 'no_answer', 'wrong_number', 'qualified'
               )),
  notes      text,
  -- Date, not timestamp: nobody schedules a callback to the minute.
  follow_up_on date,
  created_at timestamptz not null default now()
);

create index if not exists calls_user_id_idx    on public.calls (user_id);
create index if not exists calls_lead_id_idx    on public.calls (user_id, lead_id);
create index if not exists calls_created_at_idx on public.calls (user_id, created_at desc);
create index if not exists calls_follow_up_idx  on public.calls (user_id, follow_up_on)
  where follow_up_on is not null;

alter table public.calls enable row level security;

drop policy if exists calls_select_own on public.calls;
create policy calls_select_own on public.calls
  for select to authenticated using ((select auth.uid()) = user_id);

-- The `exists` clause matters: without it a caller could log a call against
-- somebody else's lead_id, and the trigger below would then rewrite that
-- stranger's lead status.
drop policy if exists calls_insert_own on public.calls;
create policy calls_insert_own on public.calls
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.leads l
      where l.id = lead_id and l.user_id = (select auth.uid())
    )
  );

drop policy if exists calls_update_own on public.calls;
create policy calls_update_own on public.calls
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists calls_delete_own on public.calls;
create policy calls_delete_own on public.calls
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Keep `leads.status` in step with the latest call, so the rest of the app can
-- keep reading one column instead of joining to find the newest outcome.
create or replace function public.sync_lead_status_from_call()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.leads
  set status = case new.outcome
                 when 'qualified'      then 'qualified'
                 when 'not_interested' then 'disqualified'
                 when 'wrong_number'   then 'disqualified'
                 else 'contacted'
               end
  where id = new.lead_id
    and user_id = new.user_id;
  return new;
end;
$$;

drop trigger if exists calls_sync_lead_status on public.calls;
create trigger calls_sync_lead_status
  after insert on public.calls
  for each row execute function public.sync_lead_status_from_call();
