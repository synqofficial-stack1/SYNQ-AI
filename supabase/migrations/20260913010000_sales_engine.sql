-- Sales as an execution engine the chatbot drives, rather than screens the user
-- configures.
--
-- A `sales_run` is one instruction ("find 20 restaurants in Hyderabad and call
-- them"). It discovers prospects, screens them for eligibility, hands the
-- eligible ones to the calling path, and ends in a report.
--
-- Prospects are deliberately NOT a second contact list. An eligible prospect is
-- promoted into `public.leads` — the same table Cold Call already works through
-- — and `prospects.lead_id` records the link. One CRM, two ways in.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Company Brain: facts the AI is allowed to state
-- ---------------------------------------------------------------------------
--
-- The sales agent is told never to invent pricing, features or guarantees. That
-- rule is only enforceable if there is somewhere authoritative to read them
-- from; this is that place.

create table if not exists public.company_facts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  category   text not null default 'about'
               constraint company_facts_category_check
               check (category in ('about', 'service', 'pricing', 'policy', 'proof')),
  label      text not null,
  content    text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_facts_user_idx on public.company_facts (user_id, category);

drop trigger if exists company_facts_touch_updated_at on public.company_facts;
create trigger company_facts_touch_updated_at
  before update on public.company_facts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Sales runs
-- ---------------------------------------------------------------------------

create table if not exists public.sales_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  -- The instruction verbatim, so the run can be explained back later.
  request        text not null,
  objective      text,
  pitch          text,
  location       text,
  industry       text,
  target_count   integer not null default 20
                   constraint sales_runs_target_check check (target_count between 1 and 200),
  -- Which ProspectSource produced the list. 'imported_leads' works today;
  -- 'google_places' returns nothing until a key is configured.
  source         text not null default 'imported_leads',
  status         text not null default 'planning'
                   constraint sales_runs_status_check
                   check (status in (
                     'planning', 'discovering', 'screening', 'ready',
                     'calling', 'completed', 'blocked', 'failed'
                   )),
  -- Why a run stopped, when the user needs to know — most often a provider
  -- that is not connected.
  blocked_reason text,
  report         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz
);

create index if not exists sales_runs_user_idx on public.sales_runs (user_id, created_at desc);

drop trigger if exists sales_runs_touch_updated_at on public.sales_runs;
create trigger sales_runs_touch_updated_at
  before update on public.sales_runs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Prospects
-- ---------------------------------------------------------------------------

create table if not exists public.prospects (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  run_id             uuid not null references public.sales_runs (id) on delete cascade,
  -- Set once the prospect passes screening and is promoted into the CRM.
  lead_id            uuid references public.leads (id) on delete set null,
  name               text not null,
  phone              text,
  website            text,
  address            text,
  category           text,
  -- Where this came from. A prospect with no source is a fabricated business,
  -- which is the one thing this table must never hold.
  source             text not null,
  source_ref         text,
  eligibility        text not null default 'pending'
                       constraint prospects_eligibility_check
                       check (eligibility in ('pending', 'eligible', 'excluded')),
  eligibility_reason text,
  outreach_status    text not null default 'pending'
                       constraint prospects_outreach_check
                       check (outreach_status in ('pending', 'called', 'skipped', 'failed')),
  created_at         timestamptz not null default now()
);

create index if not exists prospects_run_idx  on public.prospects (user_id, run_id);
create index if not exists prospects_lead_idx on public.prospects (user_id, lead_id)
  where lead_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Row level security
-- ---------------------------------------------------------------------------

alter table public.company_facts enable row level security;
alter table public.sales_runs    enable row level security;
alter table public.prospects     enable row level security;

drop policy if exists company_facts_select_own on public.company_facts;
create policy company_facts_select_own on public.company_facts
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists company_facts_insert_own on public.company_facts;
create policy company_facts_insert_own on public.company_facts
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists company_facts_update_own on public.company_facts;
create policy company_facts_update_own on public.company_facts
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists company_facts_delete_own on public.company_facts;
create policy company_facts_delete_own on public.company_facts
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists sales_runs_select_own on public.sales_runs;
create policy sales_runs_select_own on public.sales_runs
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists sales_runs_insert_own on public.sales_runs;
create policy sales_runs_insert_own on public.sales_runs
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists sales_runs_update_own on public.sales_runs;
create policy sales_runs_update_own on public.sales_runs
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists sales_runs_delete_own on public.sales_runs;
create policy sales_runs_delete_own on public.sales_runs
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists prospects_select_own on public.prospects;
create policy prospects_select_own on public.prospects
  for select to authenticated using ((select auth.uid()) = user_id);

-- The exists clause matters: a forged run_id would otherwise let a caller drop
-- prospects into another account's run.
drop policy if exists prospects_insert_own on public.prospects;
create policy prospects_insert_own on public.prospects
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.sales_runs r
      where r.id = run_id and r.user_id = (select auth.uid())
    )
  );

drop policy if exists prospects_update_own on public.prospects;
create policy prospects_update_own on public.prospects
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists prospects_delete_own on public.prospects;
create policy prospects_delete_own on public.prospects
  for delete to authenticated using ((select auth.uid()) = user_id);
