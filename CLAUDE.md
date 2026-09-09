# Synq AI — MVP Build Rules

This file is the source of truth for building this project. Any AI assistant (or future
session) working in this folder should read this first.

## What this project is

Synq AI: a platform where businesses delegate tasks to specialized AI employees. **This is the
first build.** Scope is intentionally narrow: get ONE agent working end to end.

Plain description: a mobile app. User logs in (email/password). User types a task in plain
English (e.g. "draft a follow-up email to this lead" or pastes call notes to qualify a lead).
App sends it to Claude with a fixed "Sales Agent" system prompt, gets back a result, shows it,
and saves it. A History screen lists every past run, newest first, tap to see the full output.

## Hard scope boundaries — do NOT build

- No multi-agent orchestration
- No other departments/agents beyond the one Sales Agent
- No billing
- No admin panels
- Nothing else "for later" — if tempted to scaffold it, leave a `// TODO:` comment instead and
  move on

## Stack (do not add anything outside this list without asking the user first)

- Expo (React Native + Expo Router), TypeScript
- Supabase — Auth (email/password) + Postgres database
- Anthropic API (Claude) as the agent's "brain"

Required companion packages for this stack (approved as part of it, not extras):
`@supabase/supabase-js`, `@react-native-async-storage/async-storage`, `react-native-url-polyfill`.

## Architecture decisions already made with the user

- **Git**: a fresh, separate git repo lives inside this project folder — deliberately NOT the
  Desktop-wide repo that was found to contain unrelated personal files.
- **Anthropic API calls happen server-side only**, via a Supabase Edge Function. The Anthropic
  API key is stored as a Supabase secret and never ships inside the mobile app bundle. The app
  never calls Anthropic directly.
- **Styling**: plain React Native `StyleSheet`, no UI/styling library (keeps the MVP dependency
  count minimal).
- **Package manager**: npm.
- **Model**: Claude Sonnet 5 (model id `claude-sonnet-5`) for quality on drafting/qualification.
- **Testing**: user runs the app via Expo Go on their own phone (scan QR code).

## Data model

Defined in `supabase/migrations/20260820000000_sales_agent_data_layer.sql`. This supersedes the
earlier two-table `agents` / `agent_runs` sketch, which was never built — the user asked for the
department-shaped model below instead.

- `profiles` — `id` (FK `auth.users`, PK), `business_name`, `created_at`
- `departments` — `id`, `user_id`, `department_type`, `display_name`, `system_instructions`,
  `config` (jsonb), `created_at`. Unique on `(user_id, department_type)`.
- `leads` — `id`, `user_id`, `department_id`, `name`, `phone`, `email`, `company`, `notes`,
  `status` (`new` | `contacted` | `qualified` | `disqualified`), `created_at`, `updated_at`
- `tasks` — `id`, `user_id`, `department_id`, `task_type`, `input` (jsonb), `output`,
  `status` (`pending` | `running` | `completed` | `failed`), `created_at`, `completed_at`

RLS is on for all four, with select/insert/update/delete policies scoped to `auth.uid()`.
Update policies carry both `using` and `with check` so a user cannot reassign a row to someone
else. Proof lives in `supabase/tests/rls_isolation_test.sql`.

The Sales AI system prompt is returned by the SQL function
`public.sales_agent_system_instructions()`; a trigger on `auth.users` gives every new signup a
profile and a `Sales AI` department. To change the prompt, replace that function and re-run the
backfill at the bottom of the migration.

TypeScript mirrors of these tables are hand-written in `src/types/database.ts` — keep them in
sync when the migration changes.

## App structure

- `(auth)` route group: `login`, `signup`
- `(app)` route group (requires session): `index` (submit a task to the Sales Agent),
  `import-leads` (paste a CRM CSV export to bulk-create leads), `history` (list of past runs),
  `history/[id]` (full output detail)
- Root layout checks the Supabase session and redirects between the two groups

## Working rules

- Ask the user before adding any package or external service not already listed above.
- Don't create extra documentation/README files unless the user explicitly asks.
- The user is non-technical — explain plans and questions in plain language, not jargon.
- Keep scope narrow: one agent, end to end, nothing more.

## Setup steps only the human can do (do not attempt these yourself)

1. Paste the Supabase project URL + anon key into the app's env config. **Done** — they live in
   `.env.local` (gitignored) as `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
   Note: Expo only reads files named exactly `.env`, `.env.local`, etc. — a `.txt` suffix is
   ignored, and entries must use `=` (not `-`) between name and value.
2. Create an Anthropic API key at the Anthropic Console and set it as a Supabase Edge Function
   secret (`ANTHROPIC_API_KEY`).
3. Run the SQL migration (provided in this repo) in the Supabase SQL editor.
4. Deploy the Edge Function via the Supabase CLI (assistant will give exact commands).
5. Install Expo Go on their phone and scan the QR code from `npm start`.

## Build status / progress log

- [x] **Phase 1 complete** — Expo + TypeScript + Expo Router app scaffolded, demo template
      files stripped, verified with zero TypeScript errors and zero console/server errors
      (checked via a web render), fresh git repo initialized with first commit
      (`46d995d`).
- [x] **Phase 2 complete** — Supabase client + `@react-native-async-storage/async-storage` +
      `react-native-url-polyfill` installed. Session context (`src/hooks/use-session.tsx`) wraps
      the app; `(auth)` route group (login/signup) and `(app)` route group (placeholder home with
      email + log out) redirect based on session state. Verified end-to-end via a web render:
      screens display correctly, navigation between login/signup works, zero TypeScript errors.
      Two real bugs found and fixed along the way (see "Known issues fixed" below).
      **Verified end-to-end against the live Supabase project** with real accounts: sign up
      grants access immediately, session survives a full page reload, log out returns to the
      login screen, and logging back in works. Wrong credentials show "Invalid login
      credentials". Fresh page load has zero console errors and all requests return 200.
- [x] **Phase 3 (data layer) written and verified locally** — migration creating `profiles`,
      `departments`, `leads`, `tasks` with RLS on all four (16 policies), the Sales AI prompt
      seeded per user via an `auth.users` trigger, and a CSV lead importer
      (`src/lib/csv.ts`, `src/lib/leads.ts`, `src/app/(app)/import-leads.tsx`).
      Verified by running the migration and the RLS isolation test against PGlite (Postgres
      compiled to WASM — no Docker needed): migration applies cleanly and is idempotent, all 13
      isolation checks pass, both status check constraints reject bad values. CSV parser has 15
      passing unit tests. Zero TypeScript errors. Import preview verified in the browser.
      **Not yet run against the live Supabase project** — the user still has to paste the
      migration into the SQL editor.
- [x] **Phase 4 (core task feature) written** — `supabase/functions/run-task/index.ts` (Deno Edge
      Function calling Claude), `src/lib/tasks.ts`, and the Sales AI task screen replacing the
      Phase 2 placeholder at `src/app/(app)/index.tsx`. Three jobs: qualify a lead, draft an
      email, write a call script. Text only — no telephony and no auto-sending.
      Verified in the browser: screen renders, job picker toggles, notes persist, error path
      shows a plain-language message with no hung spinner. Zero TypeScript errors.
      Migration confirmed applied to the live project (all four tables return 200).
      **Blocked on deploying the Edge Function** — until `npx supabase functions deploy run-task`
      runs, `/functions/v1/run-task` returns 404 and the Run button reports that the service
      isn't reachable.
- [ ] History list + run detail screens
- [ ] Supabase Edge Function calling Anthropic
- [ ] Fresh git repo initialized + first commit
- [ ] Plain-language setup checklist handed to user

## Known issues fixed (don't reintroduce)

- **`@supabase/supabase-js` fails to bundle on web**: its `realtime-js` sub-dependency's
  `package.json` "exports" map is misread by Metro, throwing `Unable to resolve module
  ./RealtimeClient`. Fixed via `metro.config.js` → `config.resolver.unstable_enablePackageExports
  = false`. Do not remove this file.
- **Supabase auth client crashes Expo's web server-side render** (`ReferenceError: window is not
  defined`) when its `storage` option is unconditionally set to React Native's `AsyncStorage` —
  AsyncStorage's web implementation touches `window` directly, which doesn't exist during SSR.
  Fixed in `src/lib/supabase.ts` by only passing `AsyncStorage` on native
  (`Platform.OS !== 'web'`); on web, `storage` is left undefined so supabase-js falls back to its
  own SSR-safe handling. Keep this platform check when touching that file.
- **Email confirmation is turned OFF** in the Supabase dashboard (Authentication → Sign In /
  Providers → Email → "Confirm email"), so signing up grants access immediately. Consequence:
  Supabase sends no verification email at all — the toggle is all-or-nothing. Accounts created
  *before* it was switched off stay unconfirmed and cannot log in. See the TODO in
  `src/app/(auth)/signup.tsx` for the non-blocking verification approach if it's wanted later.
