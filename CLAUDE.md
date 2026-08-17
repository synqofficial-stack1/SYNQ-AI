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

## Data model (minimal — do not expand)

`agents` table — one seed row only, for now:
- `id`, `name` ("Sales Agent"), `system_prompt`, `created_at`

`agent_runs` table:
- `id`, `user_id`, `agent_id`, `task` (text), `output` (text), `status`, `created_at`

RLS: users can only `select`/`insert` rows on `agent_runs` where `user_id = auth.uid()`. No RLS
complexity beyond that.

## App structure

- `(auth)` route group: `login`, `signup`
- `(app)` route group (requires session): `index` (submit a task to the Sales Agent), `history`
  (list of past runs), `history/[id]` (full output detail)
- Root layout checks the Supabase session and redirects between the two groups

## Working rules

- Ask the user before adding any package or external service not already listed above.
- Don't create extra documentation/README files unless the user explicitly asks.
- The user is non-technical — explain plans and questions in plain language, not jargon.
- Keep scope narrow: one agent, end to end, nothing more.

## Setup steps only the human can do (do not attempt these yourself)

1. Paste the Supabase project URL + anon key into the app's env config.
2. Create an Anthropic API key at the Anthropic Console and set it as a Supabase Edge Function
   secret (`ANTHROPIC_API_KEY`).
3. Run the SQL migration (provided in this repo) in the Supabase SQL editor.
4. Deploy the Edge Function via the Supabase CLI (assistant will give exact commands).
5. Install Expo Go on their phone and scan the QR code from `npm start`.

## Build status / progress log

- [x] Expo + TypeScript + Expo Router app scaffolded, demo template files stripped
- [ ] Supabase client packages installed
- [ ] Auth screens (login/signup) + session-aware routing
- [ ] Task-submission screen
- [ ] History list + run detail screens
- [ ] SQL migration for `agents` + `agent_runs` with RLS
- [ ] Supabase Edge Function calling Anthropic
- [ ] Fresh git repo initialized + first commit
- [ ] Plain-language setup checklist handed to user
