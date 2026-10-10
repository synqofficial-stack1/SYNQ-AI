# Synq onboarding implementation specification

## Scope and assumptions

This document specifies onboarding for the existing Synq app. The requested Next.js, Tailwind, and Supabase stack does not match the repository: Synq currently uses Expo Router, React Native, TypeScript, React Native `StyleSheet`/design tokens, Supabase Auth/Postgres, and Supabase Edge Functions. The implementation should follow those existing conventions. This is a specification only; it does not migrate the app to Next.js or change the database.

Repository facts verified during inspection:

- Routes and screens live under `src/app`; session state is provided by `src/hooks/use-session.tsx`.
- The Supabase client is in `src/lib/supabase`; AI chat is sent to the `chat` Edge Function.
- `public.profiles` is created for each Auth user by `handle_new_user()` and has self-scoped CRUD RLS policies. That trigger also seeds a Sales department.
- The `public.events` table is a platform activity timeline written by database triggers, not a product analytics event collector. Do not repurpose it for onboarding analytics.
- AI instructions are loaded by the Edge Function from the user's department row. The client currently sends optional conversation context; onboarding answers must be loaded and trusted server-side rather than accepted from that client context.

Product direction from the user: ask all accounts—including existing users—to complete the 15 questions below; questions 12 and 15 are optional. The example answers below illustrate one user's answers; they are not defaults for all users. Users should be able to edit answers later from account settings once that surface exists.

## User experience

### Route and completion behavior

After authentication, resolve the signed-in user's onboarding status. New accounts with no completed current-version onboarding record go to the onboarding flow; completed or grandfathered accounts continue to the existing app landing route. Preserve password-reset and OAuth callback handling. Do not send signed-out users into onboarding.

Suggested Expo Router organization: add an `(onboarding)` route group and a reusable `OnboardingFlow` component; keep the existing `(auth)` and `(app)` groups intact. Centralize the redirect decision in the authenticated root/layout or a small onboarding gate, rather than duplicating it in every screen. While status is loading, show the existing app loading treatment to avoid dashboard flicker. Provide a Settings entry to review/edit answers after launch.

### Steps

1. **Tell us about your business:** Q1 role (Founder / business owner; Working professional; Student / aspiring entrepreneur; Agency / freelancer; Employee at a company; Other), Q2 business stage (Just exploring an idea; Planning to launch; Recently launched; Growing an existing business; Established business), Q3 industry (Technology / SaaS; E-commerce / retail; Marketing / agency; Professional services; Education; Food / hospitality; Other), Q4 team size (Just me; 2–5; 6–20; 21–100; 100+ people).
2. **What they want from Synq:** Q5 biggest challenge (multi-select, up to 3: Finding and converting customers; Creating marketing content; Managing repetitive work; Customer support; Researching markets and competitors; Managing business operations; Planning and launching a business; Saving time and reducing costs), Q6 first goal (Find new customers; Generate more sales; Grow my audience; Automate repetitive tasks; Launch my business; Run my business more efficiently; Explore what AI can do), Q7 departments (multi-select: Sales; Marketing; Research; Operations; Customer support; Finance; HR), Q8 AI familiarity (Beginner, guide me through everything; Intermediate, I know the basics; Advanced, let me customize things).
3. **Personalize the AI experience:** Q9 working style (Do things for me with minimal input; Suggest actions and ask for approval; Guide me step by step; Let me control everything), Q10 response style (Short and direct; Detailed explanations; Step-by-step instructions; Recommendations with pros and cons), Q11 biggest priority (Growing revenue; Saving time; Reducing costs; Building a new business; Improving productivity; Learning how to use AI), Q12 optional business context free text.
4. **Discovery:** Q13 where they first heard about Synq (Instagram; YouTube; LinkedIn; X; Google search; Reddit / online communities; A friend or colleague; An influencer / creator; A blog, article, or newsletter; Other), Q14 what convinced them to try (AI employees doing real work; Sales and customer acquisition; Marketing automation; Running a business with fewer manual tasks; Curiosity about AI; A recommendation from someone), Q15 optional desired outcome free text.

Use one question per mobile screen, a visible “Step n of 15” indicator, back/continue controls, accessible selected states, and validation near the current question. Q5 is capped at three selections; Q7 is multi-select. Questions 12 and 15 are optional. Q3 and Q13 “Other” answers require a short detail. Preserve answers when navigating backward and show a saved/retry state. Do not use color alone for selection or validation. Completion routes into the existing app.

Use one question per mobile screen (or a short, tested responsive grouping on wide screens), a visible “Step n of 7” indicator, back/continue controls, selected-state accessibility, and error/help text near the relevant control. Continue is disabled until the current required answer is valid. Maintain the selected values when navigating backward. Do not use color alone to indicate selection or validation.

### Example answer record

```json
{
  "q1_role": "student_aspiring_entrepreneur",
  "q2_business": "exploring_idea",
  "q3_industry": "marketing_agency",
  "q4_team_size": "just_me",
  "q5_challenges": ["finding_converting_customers"],
  "q6_first_goal": "find_customers",
  "q7_departments": ["sales", "marketing"],
  "q8_ai_familiarity": "beginner",
  "q9_work_style": "minimal_input",
  "q10_response_style": "short_direct",
  "q11_priority": "grow_revenue",
  "q12_business_context": "",
  "q13_discovery_source": "friend_colleague",
  "q14_trial_reason": "ai_employees",
  "q15_indispensable_outcome": ""
}
```

Persist stable machine-readable option IDs; display labels are presentation-only and can change without a data migration.

## Supabase data model and security

Keep `profiles` for the existing account/business profile. The implementation migration `supabase/migrations/20261010153633_onboarding_flow.sql` adds a dedicated `public.user_onboarding_profiles` table so onboarding lifecycle and versioning do not overload the existing profile or conflict with its signup trigger. It stores Q1–Q15 as stable option IDs, Q5/Q7 as arrays, and Q12/Q15 as bounded optional text.

The migration contains a one-row-per-user table with: `user_id`, `required`, `q1_role`, `q2_business`, `q3_industry`, `q3_industry_other`, `q4_team_size`, `q5_challenges text[]`, `q6_first_goal`, `q7_departments text[]`, `q8_ai_familiarity`, `q9_work_style`, `q10_response_style`, `q11_priority`, `q12_business_context`, `q13_discovery_source`, `q13_discovery_source_other`, `q14_trial_reason`, `q15_indispensable_outcome`, `status`, `schema_version`, and lifecycle timestamps. The key security pattern is:

```sql
create table public.user_onboarding_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  required boolean not null default true,
  q1_role text,
  q2_business text,
  q3_industry text,
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
  q14_trial_reason text,
  q15_indispensable_outcome text,
  status text not null default 'draft'
    check (status in ('draft', 'completed')),
  schema_version integer not null default 1 check (schema_version > 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'completed') = (completed_at is not null))
);

alter table public.user_onboarding_profiles enable row level security;
create policy onboarding_select_own on public.user_onboarding_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy onboarding_insert_own on public.user_onboarding_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy onboarding_update_own on public.user_onboarding_profiles
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
```

The migration adds `CHECK` constraints for every option ID, caps the short “Other” values at 120 characters and longer optional text at 1000/500 characters. All required single and multi-select answers are checked before completion. An `updated_at` trigger keeps timestamps current and stamps completion. It grants only the required table privileges to `authenticated`, enables RLS, and grants no access to `anon`. The row key is always derived from `auth.uid()` in app writes; never accept a caller-supplied `user_id` as proof of ownership. Existing profile policies remain unchanged.

Review existing grants and policies before applying it; PostgreSQL policies are permissive by default, so no additional policy should widen access. No service-role key belongs in the app. Direct Supabase client writes are used for a user's own preference row under RLS and database constraints. Completion timestamps are set by a database trigger, not trusted from the app payload.

The follow-up migration `supabase/migrations/20261010154815_account_email_on_activity.sql` adds `account_email` to user-owned activity rows and keeps it synchronized from `auth.users.email`. This is a denormalized display column requested for easier database inspection; it is not an authorization key. RLS remains based on the UUID owner field. Existing `leads.email` remains the lead/contact address, and the pre-existing UUID-typed `profiles.email` column is left untouched.

### Existing accounts and signup

Do not make the existing `handle_new_user()` trigger depend on onboarding data: it runs during Auth signup and must continue to create `profiles` and the Sales department. A separate Auth trigger creates a required onboarding draft for every new account. The migration also backfills all existing Auth users with required drafts, so the authenticated app gate sends existing and new accounts through onboarding. Drafts are saved after each answer; signup itself still succeeds if the user closes the app before finishing.

### Persistence and recovery

- Save after each valid answer, with a small debounce and a visible saved/offline state. Also save when moving to the next step.
- Keep only the current draft in local app storage as a short-lived resilience cache; Supabase remains canonical. Clear local draft on sign-out/account switch, or namespace it by Auth user ID.
- On resume or another device, fetch the user's server draft and resume at the first unanswered step. Resolve concurrent edits by `updated_at` and refetch after conflict; never merge one user's cache into another user's session.
- Make completion idempotent. Retry network writes safely; do not create duplicate rows or duplicate completion events.
- Do not store email, access tokens, raw chat text, or other unnecessary personal data in onboarding answers or event properties.

## AI personalization

Personalize through a compact, structured context assembled in the `chat` Edge Function after verifying the caller's Supabase JWT. Load the caller's completed onboarding row by authenticated `user.id`; never use an onboarding object supplied by the app as trusted system context. Append a bounded section to the base department instructions, for example:

```text
USER-PROVIDED WORKING CONTEXT (preferences, not verified facts):
Role: Student / aspiring entrepreneur
Business stage: Exploring an idea
Industry: Marketing / agency
Current challenge: Generating sales
First goal: Find new customers
Preferred assistance: Execute with minimal input
Use this context to tailor examples, detail, and suggested next steps. Ask when specifics are needed; do not assume the user has an operating business, budget, audience, or authority to take external actions. Follow the existing approval and tool rules.
```

The actual values must be rendered from allowlisted IDs and known labels; escape/bound any “Other” strings and frame them as untrusted user-provided data, never instructions. Keep base safety/department instructions authoritative. AI mode may tune verbosity, number of clarifying questions, and whether to offer a suggested plan; it must not bypass confirmations or tool permissions. If there is no completed record, omit the personalization block and behave normally. Provide a user-visible way to edit/delete these preferences and explain that they tailor AI responses.

## Analytics and attribution

Use a product analytics stream separate from the existing database-triggered `public.events` platform timeline. The implementation adds `public.onboarding_events`; do not write onboarding product events into the platform activity table.

The first implementation stores `user_id`, an allowlisted event name (`started`, `step_viewed`, `answer_saved`, `completed`), optional step number, and server-defaulted timestamp. RLS permits insert only when `auth.uid() = user_id`; there are no client select, update, or delete policies. It deliberately stores no answer values or free text. This is an event capture foundation; product dashboards, retention jobs, and a richer idempotency strategy can follow without exposing raw rows to app users.

Track at minimum:

- Events are emitted at start, each step view, after saving when moving forward, and completion. No free text, answer IDs, email, chat content, or tokens are sent.
- Derive acquisition attribution from Q13 and trial-conversion reasoning from Q14 on the protected onboarding row. Campaign/referral codes are not collected in the current questionnaire.

Measure start-to-completion rate, median completion time, step-level abandonment, resume/completion rate, skip rate, and acquisition-source distribution. Define funnel denominators and deduplicate by `event_id`; aggregate reports should avoid exposing individual users. Establish a retention policy (for example, short retention for raw step events and longer retention for aggregate counts) before release.

## Validation and edge cases

- Validate enum IDs and “Other” pairing on-device and in Postgres; trim whitespace, enforce length caps, and reject unknown schema versions gracefully.
- A network loss must preserve the local draft and offer retry; it must not mark onboarding complete until the server confirms the write.
- Expired session: preserve the user-scoped draft, return to login, then resume after re-authentication.
- Repeated taps/back navigation: prevent duplicate transitions and use idempotent writes/events.
- Account switch/sign-out: clear in-memory answers and do not display the previous user's draft.
- OAuth and email signup: both enter the same authenticated onboarding gate; callback/reset paths retain their existing behavior.
- Existing users are backfilled with required drafts and enter the same onboarding flow as new users.
- “Other” selected without text, or text supplied when “Other” is not selected: show a clear validation error or discard the irrelevant text.
- Accessibility: screen-reader labels, logical focus order, keyboard support on web, visible focus, sufficient contrast, and scalable text.
- Deletion: deleting the Auth user cascades the onboarding row and any user-linked events; document how analytics retention/aggregation is handled.

## Acceptance criteria

1. A new authenticated signup sees onboarding once; a returning completed user reaches the existing app directly.
2. Each answer is persisted to that user's row; a refresh, app restart, or second device resumes the correct draft.
3. A user cannot read or alter another user's onboarding row or events; anonymous clients cannot read onboarding data.
4. Database constraints reject invalid option IDs, invalid completion state, and oversized “Other” values even if the UI is bypassed.
5. Completion requires all required answers and is safely retryable; analytics has one completion event per logical completion.
6. AI responses receive server-loaded onboarding context only for the authenticated owner; client-supplied forged context is ignored; missing onboarding data leaves existing chat behavior intact.
7. “Execute with minimal input” does not trigger external actions, publication, purchases, or calls without the existing explicit approval flow.
8. Analytics captures the defined funnel and attribution without collecting free text or secrets, and does not write onboarding events into the platform audit table.
9. Existing signup trigger, auth callbacks, password reset, dashboard, and existing data policies continue to work.
10. Users can revisit/edit answers, and the UI explains the use of these preferences.

## Recommended implementation sequence

1. Confirm product decisions: whether skip is allowed for new users, legacy-user grandfathering, analytics provider/retention, and whether acquisition attribution is optional.
2. Add a versioned Supabase migration for the onboarding table, option checks, timestamp trigger, grants, RLS, and (if selected) analytics storage. Review policy/grant interaction with the existing schema before deployment.
3. Update TypeScript database/domain types and add a small onboarding repository/service for load, draft upsert, completion, and reset/edit.
4. Build the Expo onboarding screens and accessible step component using existing design tokens; add local draft resilience and error/retry states.
5. Add the authenticated onboarding gate while preserving existing auth/callback/reset routes; grandfather pre-rollout accounts.
6. Update the chat Edge Function to fetch the completed row for the verified user and construct bounded, escaped AI context. Keep user choices out of privileged authorization decisions.
7. Add allowlisted analytics ingestion and acquisition attribution only after retention/privacy decisions are made.
8. Verify migrations and policies locally, then run UI flow checks for signup, resume, offline retry, account switching, RLS isolation, AI context ownership, and analytics deduplication before deployment.
