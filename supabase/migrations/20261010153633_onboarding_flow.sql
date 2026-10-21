-- User onboarding answers, saved per account and isolated with RLS.
create table if not exists public.user_onboarding_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  required boolean not null default true,
  q1_role text,
  q2_business text,
  q3_industry text,
  q3_industry_other text,
  q4_team_size text,
  q5_challenges text[] not null default '{}',
  q6_first_goal text,
  q7_departments text[] not null default '{}',
  q8_ai_familiarity text,
  q9_work_style text,
  q10_response_style text,
  q11_priority text,
  q12_business_context text,
  q13_discovery_source text,
  q13_discovery_source_other text,
  q14_trial_reason text,
  q15_indispensable_outcome text,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  schema_version integer not null default 1 check (schema_version > 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onboarding_role_check check (q1_role is null or q1_role in ('founder_owner','professional','student_aspiring_entrepreneur','agency_freelancer','company_employee','other')),
  constraint onboarding_business_check check (q2_business is null or q2_business in ('exploring_idea','planning_launch','recently_launched','growing_business','established_business')),
  constraint onboarding_industry_check check (q3_industry is null or q3_industry in ('technology_saas','ecommerce_retail','marketing_agency','professional_services','education','food_hospitality','other')),
  constraint onboarding_team_size_check check (q4_team_size is null or q4_team_size in ('just_me','2_5','6_20','21_100','100_plus')),
  constraint onboarding_challenges_check check (q5_challenges <@ array['finding_converting_customers','marketing_content','repetitive_work','customer_support','market_competitor_research','business_operations','business_planning_launch','saving_time_costs']::text[] and cardinality(q5_challenges) <= 3),
  constraint onboarding_goal_check check (q6_first_goal is null or q6_first_goal in ('find_customers','generate_sales','grow_audience','automate_tasks','launch_business','run_efficiently','explore_ai')),
  constraint onboarding_departments_check check (q7_departments <@ array['sales','marketing','research','operations','customer_support','finance','hr']::text[]),
  constraint onboarding_familiarity_check check (q8_ai_familiarity is null or q8_ai_familiarity in ('beginner','intermediate','advanced')),
  constraint onboarding_work_style_check check (q9_work_style is null or q9_work_style in ('minimal_input','suggest_ask_approval','step_by_step','full_control')),
  constraint onboarding_response_style_check check (q10_response_style is null or q10_response_style in ('short_direct','detailed','step_by_step','pros_cons')),
  constraint onboarding_priority_check check (q11_priority is null or q11_priority in ('grow_revenue','save_time','reduce_costs','build_business','improve_productivity','learn_ai')),
  constraint onboarding_source_check check (q13_discovery_source is null or q13_discovery_source in ('instagram','youtube','linkedin','x','google_search','reddit_communities','friend_colleague','influencer_creator','blog_newsletter','other')),
  constraint onboarding_reason_check check (q14_trial_reason is null or q14_trial_reason in ('ai_employees','sales_acquisition','marketing_automation','fewer_manual_tasks','ai_curiosity','recommendation')),
  constraint onboarding_other_lengths check (
    (q3_industry_other is null or char_length(btrim(q3_industry_other)) <= 120) and
    (q13_discovery_source_other is null or char_length(btrim(q13_discovery_source_other)) <= 120) and
    (q12_business_context is null or char_length(btrim(q12_business_context)) <= 1000) and
    (q15_indispensable_outcome is null or char_length(btrim(q15_indispensable_outcome)) <= 500)
  ),
  constraint onboarding_completion_check check (
    (status = 'draft' and completed_at is null) or
    (status = 'completed' and completed_at is not null and q1_role is not null and q2_business is not null and q3_industry is not null and (q3_industry <> 'other' or nullif(btrim(q3_industry_other), '') is not null) and q4_team_size is not null and cardinality(q5_challenges) between 1 and 3 and q6_first_goal is not null and cardinality(q7_departments) >= 1 and q8_ai_familiarity is not null and q9_work_style is not null and q10_response_style is not null and q11_priority is not null and q13_discovery_source is not null and (q13_discovery_source <> 'other' or nullif(btrim(q13_discovery_source_other), '') is not null) and q14_trial_reason is not null)
  )
);

create or replace function public.touch_onboarding_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at = now();
  elsif new.status = 'draft' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists onboarding_touch_updated_at on public.user_onboarding_profiles;
create trigger onboarding_touch_updated_at before update on public.user_onboarding_profiles
for each row execute function public.touch_onboarding_updated_at();

alter table public.user_onboarding_profiles enable row level security;
drop policy if exists onboarding_select_own on public.user_onboarding_profiles;
create policy onboarding_select_own on public.user_onboarding_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists onboarding_insert_own on public.user_onboarding_profiles;
create policy onboarding_insert_own on public.user_onboarding_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists onboarding_update_own on public.user_onboarding_profiles;
create policy onboarding_update_own on public.user_onboarding_profiles
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.user_onboarding_profiles to authenticated;
revoke all on public.user_onboarding_profiles from anon;

-- Existing and new accounts use the same required onboarding flow. Existing
-- answers are never overwritten if this migration is safely re-applied.
insert into public.user_onboarding_profiles (user_id, required, status)
select id, true, 'draft' from auth.users
on conflict (user_id) do update set required = true;

create or replace function public.seed_user_onboarding_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_onboarding_profiles (user_id, required)
  values (new.id, true)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.seed_user_onboarding_profile() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_onboarding on auth.users;
create trigger on_auth_user_created_onboarding after insert on auth.users
for each row execute function public.seed_user_onboarding_profile();

-- Minimal product funnel events. No answers or free text are written here.
create table if not exists public.onboarding_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null check (event_name in ('started','step_viewed','answer_saved','completed')),
  step integer check (step between 1 and 15),
  created_at timestamptz not null default now()
);
create index if not exists onboarding_events_user_created_idx
  on public.onboarding_events (user_id, created_at desc);
alter table public.onboarding_events enable row level security;
drop policy if exists onboarding_events_insert_own on public.onboarding_events;
create policy onboarding_events_insert_own on public.onboarding_events
  for insert to authenticated with check ((select auth.uid()) = user_id);
grant insert on public.onboarding_events to authenticated;
revoke all on public.onboarding_events from anon;
