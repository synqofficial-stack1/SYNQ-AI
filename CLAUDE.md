# Synq AI — operating manual for Claude Code

This file describes the project **as it actually exists in this repository**. It was first written
on 2026-09-21 and **re-verified against the repo and the live Supabase project on 2026-10-22**
(see §0). Anything that could not be verified is marked **Unknown / needs verification**.
Deeper detail lives in `docs/`:

| Document | Contents |
|---|---|
| `docs/architecture.md` | Routes, Edge Functions, data flow, client/server boundaries |
| `docs/database.md` | Every table, column, constraint, RLS policy, trigger, bucket |
| `docs/design-system.md` | Tokens, typography, components, branding, UI conventions |
| `docs/roadmap.md` | What is built, half-built, blocked, and not started |
| `docs/company-workspaces.md` | Organizations, owner approval, shared records |
| `docs/sales-workspace.md` | Deal pipeline, meetings, quotations, targets |
| `docs/email-outreach.md` | Gmail outreach duties, reply analysis, reports |
| `docs/daily-ai-credits.md` | Server-enforced daily AI credit balance |

---

## 0. Live state and repo/production drift (verified 2026-10-22)

**Rule: production must never be changed without committing the same change here first.** On
2026-10-22, six migrations and one Edge Function were found live but missing from the repo. They
have been recovered verbatim (each file says so in its header comment). Before any deploy or
migration, re-run the checks in §23 steps 5–6.

Still open after that sync (needs a deliberate decision, not a silent fix):

| Drift | Effect | Fix |
|---|---|---|
| `20261016091113_allow_4k_video_resolution.sql` (repo) widened `videos_duration_check` to `4,5,6,8,10,12,15`. Live only ran the resolution half (recorded as `20261016091518`). Live check is still `4,6,8`. | The deployed fal `generate-video` accepts 4–15 s, so 5/10/12/15 s requests **fail at the insert** in production. | Apply the duration part of `…091113` live. |
| `20261010090000_sales_call_reports.sql` is **not applied**: `sales_runs.call_questions` does not exist live. `call-report` is **not deployed**, and the deployed `call-number` is the original version 18. | Call reports do not work in production. | Apply the migration, then deploy `call-number` and `call-report` together. |
| `20261010180000_ai_mode_images.sql` and `20261013090000_ai_daily_credits.sql` are not in the live migration history, but their tables, functions and buckets exist live. | Applied by hand. Schema matches; history does not. | Record them as applied (`supabase migration repair`) rather than re-running them. |
| `vapi_calls` table + `vapi-call-result` function exist, but nothing in `src/` starts a Vapi call. | Dead until a client is built. | Decide: build it or drop both. |
| `social-auth` / `social-post` code is **back in the repo** and `/plugins` screens use `social_posts`. They were deleted in `5f6bf52` and later restored. | §12/§19 statements about social publishing being removed are outdated. | Treat social publishing as present but unverified. |

Not verified on 2026-10-22: which Edge Function secrets are set, real usage numbers, and whether
typecheck/lint still pass (the dependency install could not run in that environment).


## 1. Project overview and product purpose

Synq AI is a **mobile-first app (Expo / React Native, also runs on web)** where a small business
delegates work to "AI employees" grouped into departments. As of 2026-10-22:

- **Company workspaces** — an owner creates a company; teammates request to join and the owner
  approves. Leads, email duties, replies, reports and deals are shared inside the company.
- **Sales** — a shared deal pipeline (stages, next actions, meetings, quotations, monthly
  targets, CSV export) and **Gmail outreach duties** (AI-drafted emails, per-recipient sending,
  reply sync every minute via `pg_cron`, AI reply analysis, reports). This is the most complete
  flow. Single-number AI voice calling (ElevenLabs + Twilio) exists in code but depends on
  provider setup (§20).
- **Marketing** — a Gemini chat with video generation (**fal.ai Seedance**, not Veo, since
  `0b79817`) and social publishing screens under `/plugins`.
- **AI Mode** — a full-screen assistant with Pollinations image generation and posters.
- Supporting CRM screens: lead import, follow-ups, activity history. `/cold-call` redirects to
  Sales.

The app name in `app.json` is "Synq AI", slug `synq-ai`, scheme `synqai`.

## 2. Tech stack (from `package.json`, `app.json`)

- **Expo SDK ~57.0.14**, `expo-router` ~57 (file-based routes, `experiments.typedRoutes: true`,
  `experiments.reactCompiler: true`), **React Native 0.86.2**, **React 19.2.3**,
  `react-native-web` ~0.21 (`web.output: "static"`).
- **TypeScript ~6.0.3, `strict: true`**, path aliases `@/*` → `src/*`, `@/assets/*` → `assets/*`.
  `supabase/functions` is excluded from the app tsconfig (it is Deno, not RN).
- **Supabase** (`@supabase/supabase-js` ^2.112.3): auth, Postgres + RLS, Edge Functions, Storage.
- **Google Gemini** for text, **fal.ai Seedance 2.0** for video, **Pollinations** for images,
  **Gmail API** for outreach, all called only from Edge Functions. **ElevenLabs Conversational
  AI** for voice calls, **Twilio** as the phone carrier behind it, **Google Places (New)** for
  business discovery.
- Styling is **plain React Native `StyleSheet`** with tokens in `src/constants/theme.ts`.
- ESLint 9 + `eslint-config-expo` (`eslint.config.js`, with a TypeScript import resolver so `@/`
  paths resolve).

**There is no Next.js, no Tailwind, no server actions, no middleware, no API routes.** If a task
description mentions those, it is wrong about this repo — server code is Supabase Edge Functions.

**Installed but unused anywhere in `src/`** (verified by grep): `lucide-react-native`,
`react-native-gifted-charts`, `sonner-native`, `react-hook-form`, `expo-glass-effect`, `@expo/ui`,
`expo-device`, `expo-symbols`, `expo-constants`, `expo-font`, `@expo-google-fonts/geist`,
`@expo-google-fonts/geist-mono`, `react-native-gesture-handler`, `react-native-reanimated`.
Do not assume a charting or toast library is in use; charts on the dashboard are hand-drawn Views.

## 3. Directory structure

```
src/
  app/                     expo-router routes (see docs/architecture.md)
    _layout.tsx            SessionProvider + ThemeProvider + Stack
    index.tsx              redirect: session ? /(app) : /(auth)/login
    reset-password.tsx     password reset landing (outside the auth group on purpose)
    (auth)/                login, signup, forgot-password  (+ _layout guard)
    (app)/                 dashboard, company, sales, marketing, ai-mode, plugins/,
                           cold-call (redirect), follow-ups, import-leads, upgrade,
                           ceo, history/   (+ _layout guard + AppShell)
    (onboarding)/          personalised onboarding
    workspace-setup.tsx    company name + owner/teammate choice after sign-in
  components/              shared UI (see docs/design-system.md)
  features/ai-mode/        AI Mode (plain JS/JSX + CSS; bridge.ts talks to Supabase)
  hooks/                   use-session (auth context), use-theme, use-color-scheme
  lib/                     supabase client, auth helpers, feature data layers
    sales/                 runs.ts (sales data layer), compliance.ts, sources.ts
  constants/theme.ts       colors, spacing, radius, breakpoints, fonts
  types/database.ts        hand-written mirrors of the DB tables
supabase/
  migrations/*.sql         schema, applied in filename order (see §0 for live drift)
  functions/*/index.ts     Deno Edge Functions; shared code in functions/_shared/
  tests/*.sql              rollback-only SQL proofs (RLS, admin, workspaces, sales, email, credits)
scripts/                   developer CLI tools + Node test suites (`npm run test:*`)
assets/images/             icons, splash, synq-logo.jpg
```

## 4. Important files

| File | What it does |
|---|---|
| `src/lib/supabase.ts` | The single Supabase client. AsyncStorage on native, undefined storage on web (SSR-safe), `detectSessionInUrl` on web only. |
| `src/hooks/use-session.tsx` | The only React context in the app: `{ session, isLoading }` from `getSession()` + `onAuthStateChange`. |
| `src/lib/auth.ts` | Google OAuth (web redirect vs native `openAuthSessionAsync` + token/code handling), password-reset email, `authErrorMessage()` wording. |
| `src/lib/sales/runs.ts` | Sales data layer: `callNumber`, `checkCall`, `loadRecentCalls`, `loadLastPitch`, `loadSalesDashboard`, `toSheetRows`, plus the older list-run helpers. |
| `src/lib/sales/compliance.ts` | Calling window (9am–9pm), prospect screening, attestation terms, suppression set. |
| `src/lib/workspace.ts` | Dashboard numbers — arithmetic over the user's own `tasks`, `messages`, `calls` rows. |
| `src/components/app-shell.tsx` | Sidebar/top-bar chrome, route titles, command palette destinations. |
| `src/components/chat-panel.tsx` | The department chat UI; sends `kind`, never a prompt. |
| `supabase/functions/chat/index.ts` | One chat turn + tool calling; picks the system prompt from the caller's `departments` row. |
| `supabase/functions/call-number/index.ts` | Single-number voice call: start + status polling; the path the Sales screen uses. |
| `supabase/functions/place-calls/index.ts` | Batch calling for a whole approved run (ElevenLabs batch API). **Currently not reachable from any screen.** |
| `supabase/functions/discover-prospects/index.ts` | Google Places search + screening; writes `prospects`. |
| `supabase/functions/generate-video/index.ts` | fal.ai Seedance start/check, stores the file in the `generated-videos` bucket. |
| `supabase/functions/email-outreach/index.ts`, `email-worker/index.ts` | Gmail outreach: drafting, sending, reply sync and analysis. Gmail tokens are encrypted server-side. |
| `src/components/sales-workspace.tsx`, `src/components/email-outreach.tsx` | The two largest screens: the deal pipeline and the email duty workspace. |
| `supabase/functions/run-task/index.ts` | Older one-shot task runner writing `tasks` rows (History screens read these). Keep it. |
| `supabase/functions/admin-console/index.ts` | **The authorization boundary for `/ceo`.** Checks `app_admins` with the service-role key before reading anything, then returns the whole-platform snapshot, activity feed, search and user drill-down. |
| `src/lib/admin.ts` | Client for that function. `isAdmin()` only decides whether to *show* the console — it is not a security check. |
| `src/app/(app)/ceo.tsx` | The CEO Control Center screen. |

## 5. Authentication architecture

- Email/password sign-up and sign-in through Supabase Auth (`signInWithPassword`, `signUp`).
- **Google sign-in** is implemented in `src/lib/auth.ts`. Web: `signInWithOAuth` redirect, session
  read back from the URL. Native: `skipBrowserRedirect` + `expo-web-browser`, then
  `exchangeCodeForSession` (PKCE) or `setSession` (implicit). The provider is **on** (verified
  2026-09-22: `/auth/v1/settings` reports `external.google: true`, and the button reaches Google's
  real consent screen). `signInWithGoogle()` still pre-checks that endpoint, because
  `signInWithOAuth` navigates without asking the server — if the provider is ever switched off
  again, the check turns a page of raw JSON into a sentence. It fails open. Setup and the exact
  redirect URLs: `docs/architecture.md` §3b.
- **Password reset**: `(auth)/forgot-password.tsx` sends the email; `src/app/reset-password.tsx`
  (deliberately outside the `(auth)` group, because that group redirects anyone holding a session)
  calls `updateUser({ password })`.
- Route guards: `(app)/_layout.tsx` redirects to login without a session; `(auth)/_layout.tsx`
  redirects to the app with one; `src/app/index.tsx` picks between them.
- Email confirmation: the app is built for it **on** (signup shows "check your inbox" with a resend
  link; login offers a resend for unconfirmed accounts), which is what keeps made-up addresses out.
  The live dashboard setting was still **off** on 2026-10-23 (`mailer_autoconfirm: true`), so until
  someone enables Authentication → Email → "Confirm email", signup still lets anyone straight in.
  Supabase's built-in mailer only delivers to team addresses, so real customers also need custom SMTP.

## 6. Supabase architecture

- **Postgres + RLS on every table.** Personal tables use `auth.uid() = user_id`, with `using`
  *and* `with check` on updates, and `exists` ownership checks where a row points at a parent
  (`prospects.run_id`, `messages.conversation_id`, `videos.conversation_id`). **Company tables**
  (leads, outreach, `sales_deals`, `sales_targets`) use approved-membership checks through
  `security definer` helpers such as `current_organization()` and `owns_organization()`.
  Several tables (`ai_credit_*`, `outreach_mailboxes`, `outreach_*oauth_states`,
  `outreach_suppressions`, `oauth_states`, `social_connections`) have RLS on with **no policies on
  purpose**: only the service role touches them.
- **Edge Functions (Deno)** hold every third-party key. The app never calls Gemini, Veo,
  ElevenLabs, Twilio or Google Places directly.
- **Storage** (live 2026-10-22): private buckets `generated-videos`, `ai-images`,
  `marketing-uploads` and `call-audio`.
- **Deployed functions** (verified live 2026-10-23): `admin-console`, `call-audio`,
  `call-number`, `call-result` (verify_jwt off), `chat`, `delete-account` (the only caller of
  the service-only `delete_account` SQL function), `discover-prospects`, `email-outreach`,
  `email-worker` (verify_jwt off), `generate-image`, `generate-video` (fal), `gmail-auth`
  (verify_jwt off), `place-calls`, `request-ceo-alert` (Settings), `run-task`, `social-auth`
  (verify_jwt off), `social-post`, `vapi-call-result` (verify_jwt off).
  **In the repo but not deployed:** `call-report`. **Deployed but not in the repo:**
  `upgrade-notify` (source unknown; recover it before changing it).
- The Supabase **CLI is not logged in** in this environment; migrations and deploys are done with
  the Supabase MCP tools (`apply_migration`, `deploy_edge_function`, `execute_sql`). Project ref:
  `jjdrlgwpvxyxeruyygli` (the URL and publishable key live in `.env.local`, which is gitignored).

## 7. Database schema (summary — full detail in `docs/database.md`)

Original core: `profiles`, `departments`, `leads`, `tasks`, `calls`, `campaigns`,
`content_items`, `conversations`, `messages`, `company_facts`, `sales_runs`, `prospects`,
`videos`, `app_admins`, `events`.

Added since (see the migrations and `docs/`): `organizations`, `organization_members`,
`sales_deals`, `sales_targets`, `outreach_campaigns`, `outreach_recipients`,
`outreach_messages`, `outreach_mailboxes`, `outreach_oauth_states`, `outreach_suppressions`,
`ai_credit_accounts`, `ai_credit_debits`, `generated_images`, `user_onboarding_profiles`,
`onboarding_events`, `social_connections`, `social_posts`, `oauth_states`, `marketing_media`,
`marketing_post_drafts`, `vapi_calls`, `feedback_messages`. `docs/database.md` predates most of
these.

Relationships that matter:

- `auth.users` → `profiles` (1:1) and `departments` (one row per department type) are seeded by the
  `handle_new_user` trigger. Department types: **`sales`, `marketing`, `workspace`, `sales_crm`**.
- `sales_runs` 1→N `prospects`; a called prospect is promoted into `leads` and its outcome logged
  in `calls`; `calls` has a trigger that syncs `leads.status`.
- `conversations` 1→N `messages`; `videos` belong to a conversation.
- `campaigns`, `content_items` and `company_facts` exist in the schema but **no app code reads or
  writes them** (verified by grep). Do not describe them as features.
- `events` is the platform timeline, written by **AFTER triggers** on `tasks`, `videos`, `calls`,
  `leads`, `sales_runs`, `prospects`, `conversations` and `profiles`. No application code writes
  it. Every trigger swallows its own errors on purpose: a failed log must never fail a user's
  write. `app_admins` names the accounts that may read across users and has **no insert policy** —
  grants happen with the service-role key only.

## 8. Multi-tenant / workspace model

**Superseded 2026-10-21** by `20261021090000_company_workspaces.sql` (detail:
`docs/company-workspaces.md`). There are now `organizations` and `organization_members` tables.
The first person to claim a company name is its owner; anyone else becomes a **pending** member
until the owner approves. Pending and removed users cannot read company records. Leads, email
duties, replies, reports, deals and targets are shared per company; AI chats and Gmail
credentials stay personal. Only the owner can approve, remove or set targets. Ownership is
self-declared, not verified, and owner transfer / account deletion are not implemented.

`app_admins` is unchanged: it grants platform-wide read in the CEO console, not membership.

## 9. API architecture and client/server boundary

- The client talks to Postgres through supabase-js (RLS-enforced) and to Edge Functions through
  `supabase.functions.invoke(...)`. Functions called from the app (2026-10-22 grep): `chat`,
  `run-task`, `generate-image`, `generate-video`, `admin-console`, `email-outreach`, the sales
  functions via `src/lib/sales/runs.ts`, `discover-prospects` via `sources.ts`, and the social
  functions via `src/lib/social.ts`. `email-worker` is run by `pg_cron` every minute, not by the app.
- Everything is client-rendered React Native. Expo's web build does prerender HTML
  (`web.output: "static"`), so **any module that touches `window` at import time breaks the web
  build** — see the AsyncStorage note in `src/lib/supabase.ts`.
- **System prompts never leave the server.** The client sends a `kind`; `chat/index.ts` looks up
  the matching `departments.system_instructions` row for that user.
- Model tools are read-only plus `start_sales_run`; **no tool can place a call, delete, or publish**.

## 10. State management

React `useState`/`useEffect` in screens, one context (`SessionProvider`), and per-feature async
functions in `src/lib/*`. Long-running work is polled, not subscribed (no Realtime). There is no
Redux/Zustand/React Query/Context store — do not add one without asking.

## 11. Design system and branding (detail in `docs/design-system.md`)

- Tokens in `src/constants/theme.ts`: `Colors.light/.dark`, `AccentColors` (gold `#d4af37`,
  `primaryLight #e8c547`, `primaryDark #aa8c2c`, plus success/error/warning), `Spacing`
  (half…six), `Radius`, `SidebarWidth 240`, `WideBreakpoint 900`, `MaxContentWidth 800`.
- `app.json` sets `userInterfaceStyle: "dark"` and splash `#09090B`. The app is dark-first with
  gold accents; `ThemedText`/`ThemedView` read the active theme.
- **Logo**: `assets/images/synq-logo.jpg` is the original badge (108×108, dark square, no
  transparency). `assets/images/synq-mark.png` is the building mark cut out of it onto
  transparency (312×448, aspect 0.696) and is what the auth screens and the sidebar actually
  render — `contentFit="contain"`, height set, width derived, no border radius. The launcher icon, splash and Android adaptive icons are **still the Expo
  template artwork**, not Synq branding.
- Fonts: `src/global.css` defines web font variables (Spline Sans / Inter fallbacks); `Fonts` in
  `theme.ts` maps to them. The Geist font packages are installed but never loaded.

## 12. Department, dashboard and feature architecture

- **Dashboard** (`(app)/index.tsx`): greeting with one **Create** menu (every quick action lives
  there), metrics, a usage chart, departments, recent activity, this month's **Targets**, tasks and
  an assistant chat. All numbers come from the user's own rows via `src/lib/workspace.ts` and
  `src/lib/sales-workspace.ts` — **there is no analytics service, and none of it is demo data**.
- **Sales** (`(app)/sales.tsx`, updated 2026-10-23): `components/sales-workspace.tsx` with
  Overview (KPIs, activity, upcoming meetings, Sales AI, calendar, targets — the deal pipeline board
  was removed), Meetings (an Upcoming/Past dropdown), Targets and Email duties
  (`components/email-outreach.tsx`). The header has **Send email** (`components/send-email.tsx`:
  one email to one person from the connected Gmail via `email-outreach` `send_one`, which checks
  opt-outs, caps 50 a day and logs `email.direct_sent` without content) and **Ask Synq AI**.
  See `docs/sales-workspace.md` and `docs/email-outreach.md`. Gmail sending needs the `GMAIL_*`
  secrets and a connected mailbox; on 2026-10-23 no mailbox had ever been connected.
  Google Maps discovery and whole-list calling are still not reachable from the UI.
- **Sales sub-pages**: `/cold-call` now **redirects to Sales** (old call records are kept),
  `/follow-ups` (callbacks due), `/import-leads` (CSV/spreadsheet import).
- **Marketing** (`(app)/marketing.tsx`): **Ask Marketing AI** plus the reel publisher
  (`components/marketing-publisher.tsx`). A post goes to **every connected plugin whose publishing
  is on**; the Publish settings list is view-only and connections are managed on `/plugins`.
  Uploads show their status and next steps; the library switches between Saved drafts and Uploads.
  Whether the social OAuth secrets are set live is **Unknown / needs verification**.
- **Theme**: kept on the device and on the account (`profiles.appearance`), applied at every
  sign-in by `syncAppearanceWithAccount` in `src/lib/appearance.ts`.
- **Plans** (`(app)/upgrade.tsx`): hardcoded pricing tiers. The screen itself states there is no
  payment provider. **Not a billing system.**
- **CEO Control Center** (`(app)/ceo.tsx`, route `/ceo`): the whole platform for the accounts in
  `app_admins` — company overview, accounts, AI workforce, usage, a live activity feed (polled
  every 15s), errors, integration health, security, global search and per-account drill-down.
  Revenue, organisations and automations appear as **named gaps with the reason**, because Synq has
  no data source for them. The nav item is hidden for everyone else, but the boundary is the
  `admin-console` function, which 403s a signed-in non-admin.
- **Automations / notifications / settings**: mostly not implemented. The only scheduler is the
  `pg_cron` job `synq-email-replies` (every minute) for outreach. Webhook receivers: `call-result`
  and `vapi-call-result`. Settings (`/settings`, opened from the gear beside the user's name) has
  profile, security, appearance, credits, help and account deletion. The notification bell shows
  join requests, admins' incoming feedback (with a "Looking into it" button) and, for the sender,
  when their feedback was acknowledged. It is polled every minute, not pushed.

## 13. Voice-calling pipeline (the most safety-sensitive part)

`call-number` is the path the app uses. Before anything rings it checks, in order: signed in (RLS),
the user ticked that they have permission, local time is 09:00–21:00, the number is not flagged
`do_not_call`, and the ElevenLabs secrets exist. It then creates a `sales_runs` row + one
`prospects` row, calls ElevenLabs `/v1/convai/twilio/outbound-call`, stores the conversation id, and
the Sales screen polls `action: 'status'` until the conversation is `done`/`failed`, at which point
the note, temperature, summary and a `calls` row are written.

`place-calls` (batch) additionally requires `sales_runs.attested_at` — set only by a human pressing
approve. `call-result` is the ElevenLabs post-call webhook (HMAC-signed, `verify_jwt` off) used by
the batch path.

**Requirements that are outside the repo** (Unknown / needs verification): a paid Twilio account,
a Twilio number imported into ElevenLabs, and the `ELEVENLABS_*` secrets set on Supabase.

## 14. Environment variables (names only — never write values)

Client (`.env.local`, gitignored; `.env.example` is the tracked template):
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

Supabase Edge Function secrets, by function:

| Secret | Used by |
|---|---|
| `GEMINI_API_KEY` | `chat`, `run-task`, `generate-video`, `call-number`, `call-result` |
| `GOOGLE_PLACES_API_KEY` | `discover-prospects` |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_PHONE_NUMBER_ID` | `call-number`, `place-calls` |
| `ELEVENLABS_WEBHOOK_SECRET` | `call-result` |
| `FAL_AI_API_KEY` (alias `FAL_KEY`) | `generate-video` |
| `POLLINATIONS_API_KEY`, `POLLINATIONS_IMAGE_MODEL` (optional model override) | `generate-image` (AI Mode images/poster backgrounds) |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_TOKEN_ENCRYPTION_KEY`, `GMAIL_ALLOWED_ORIGINS`, `OUTREACH_WORKER_SECRET`, `OUTREACH_AI_MODEL` (optional) | `gmail-auth`, `email-outreach`, `email-worker` |
| `CALL_REPORT_MODEL` (optional), `SALES_CALL_PROVIDER` | call reports / call provider choice |
| `VAPI_WEBHOOK_SECRET` | `vapi-call-result` |
| `SOCIAL_TOKEN_ENCRYPTION_KEY`, `SOCIAL_ALLOWED_ORIGINS`, `X_CLIENT_*`, `YOUTUBE_*` | `social-auth`, `social-post` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | injected by the platform |

Gmail outreach requests `gmail.send` (sensitive) and `gmail.readonly` (**restricted**). Google
requires app verification before users outside the OAuth client's test-user list can connect, and
restricted scopes normally also require an annual third-party security assessment. Plan for this
before inviting real customers.

Developer-only names also present in `.env.local` for `scripts/`: `ELEVEN_LABS_API`,
`ELEVEN_LABS_KEY_ID_OLD`, `ELEVENLABS_VOICE_ID`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_FROM_NUMBER`, `SYNQ_CALL_AUDIO_TOKEN`, `GOOGLE_MAPS_API`, `GEMINI_API_KEY`,
`FISH_AUDIO_API_KEY` (unused). `supabase/.env.secrets` (gitignored) stages function secrets.

## 15. Commands

```bash
npm start            # Expo dev server (launch.json also defines web on 8082, native on 8083)
npm run web          # Expo web
npm run lint         # expo lint (ESLint 9)
node node_modules/typescript/bin/tsc --noEmit          # typecheck
node node_modules/expo/bin/cli export --platform web   # production web build
```

```bash
npm run test:calls  test:ai-mode  test:credits  test:email  test:sales  test:video
```

These use Node's built-in test runner and need no install. GitHub Actions
(`.github/workflows/tests.yml`) runs all six on pushes and PRs to `main`/`master`. On 2026-10-22
all passed (65 + 4 video). There are **no browser tests**; the Playwright template test was removed
because it tested playwright.dev, not Synq. `playwright.config.ts` and the dependency remain for
when a real end-to-end test is written.

The SQL proofs in `supabase/tests/*.sql` (RLS isolation, admin access, company workspaces, sales
workspace, email outreach, AI credits) are run by hand in the Supabase SQL editor. They assert
rather than print, and the newer ones run in rollback-only transactions.

Environment quirks worth knowing: **PowerShell's execution policy blocks `npx`/`npm` here**, so run
Node tooling through the Bash tool with explicit paths as above. The Supabase CLI is not logged in;
use the Supabase MCP tools instead.

## 16. Git conventions

- Default branch on GitHub (`synqofficial-stack1/SYNQ-AI`): **`main`**. Work lands through
  feature branches and pull requests (e.g. `codex/email-outreach`, `codex/daily-ai-credits`).
  Prefer small, focused commits with short imperative subjects, e.g. "Marketing is one chat now".
- The first store release targets **Android / Google Play** (see
  `docs/play-store-release-readiness.md`).
- More than one AI agent works on this repo. Follow `AGENTS.md`: inspect the tree first, never
  discard someone else's work, and never change production without committing the change.
- Commit messages explain *why* in the body when the change is not obvious.
- End commit messages with: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Never `git add -A` blindly — stage explicit paths. `.env*` is gitignored except `.env.example`.
- Commit only when asked.

## 17. Security rules (non-negotiable)

1. **Never print, log, commit or paste secret values.** Names, lengths and prefixes only.
2. Third-party keys live in Supabase secrets, never in the app bundle. Only `EXPO_PUBLIC_*` values
   may reach the client.
3. The service-role key is used **only** inside Edge Functions, never with a user session.
4. Keep RLS on and keep every policy scoped to `auth.uid()`. New tables need policies in the same
   migration.
5. **Never fabricate business data.** Prospects come from Google Places; a model must never invent
   a business, phone number, or website.
6. **Never fake an outcome.** If a provider is not configured, say "Calling integration not
   configured" — do not simulate a call, a post, an email, or analytics.
7. Do not weaken calling safeguards: the 9am–9pm window, `attested_at`, the permission checkbox,
   `do_not_call`, and the rule that no model tool can dial.
8. Do not add code that bypasses telecom, consent or do-not-call rules.
9. **Cross-user reads happen in one place only**: the `admin-console` Edge Function, after it has
   checked `app_admins` with the service-role key. Never add a client-side admin check that grants
   anything, never widen an RLS policy to "admins can see everything" on a table the app reads,
   and never return message text, prompts, transcripts or secret values to that console — it
   reports activity, not content. The one exception is `feedback_messages`, which people write
   *to* the Synq team from Settings > Help; admins read them in the notification bell.

## 18. Coding conventions

- TypeScript strict; explicit types on exported functions. Hand-write table types in
  `src/types/database.ts` when a migration changes.
- Plain `StyleSheet` objects at the bottom of the file; tokens from `@/constants/theme`.
- Comments explain **why**, not what — match the existing density and tone.
- Errors surface as plain-language sentences a non-technical user can act on.
- Ask before adding any dependency or external service.
- Keep the user-facing voice: short, concrete, never salesy.

## 19. Architectural decisions already made

- Supabase over a custom backend; Edge Functions over an app server.
- Gemini (not Anthropic) for text; the model id used across functions is `gemini-3.6-flash`.
- Prompts live in the database (`departments.system_instructions`), not in the client.
- Polling over Realtime/webhooks for long jobs (video, calls) — simpler and needs no public URL.
- `metro.config.js` sets `unstable_enablePackageExports = false` (Supabase + Metro web bug).
  **Do not remove it.**
- Marketing was deliberately reduced from CRUD pages to one chat. Social publishing was removed in
  `5f6bf52` and **restored in `1831203`** (2026-10-10); treat the later restore as current.
- Video moved from Google Veo to **fal.ai Seedance 2.0** (`0b79817`, 2026-10-18).
- Teams use company workspaces with owner approval (2026-10-21), not invitations.

## 20. Known limitations and incomplete work

- **Start with §0** for the repo/production drift found on 2026-10-22.
- Security advisor (2026-10-22): leaked-password protection is **off** (dashboard toggle);
  `marketing_agent_system_instructions` and `sales_agent_system_instructions` have a mutable
  `search_path`; seven `security definer` RPCs are executable by signed-in users
  (`current_organization`, `get_ai_usage`, `organization_people`, `owns_organization`,
  `review_organization_member`, `setup_workspace`, `workspace_identity`). Those seven are likely
  intentional, but each needs a reviewed reason recorded here.
- Integration status below is **from 2026-09-21 and is stale**. Video has since moved to fal, so
  the Veo line no longer applies. Re-check secrets before claiming any provider works.
  It was verified by the CEO console's health check (which reads only whether a secret is present):
  - `GEMINI_API_KEY` **is** set; the most recent Gemini call succeeded.
  - `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_PHONE_NUMBER_ID` are **not set**, so
    voice calling cannot dial at all. A paid Twilio account and a number linked to the agent are
    still needed on top of that.
  - `GOOGLE_PLACES_API_KEY` is **not set**, so discovery is blocked.
  - **Google sign-in is enabled** (2026-09-22) against a Web-application OAuth client. The
    `*credentials*.json` file in the project root is a *Desktop* client and is **not** the one in
    use; it is gitignored and can be deleted.
  - Veo runs on `GEMINI_API_KEY` and is **failing**: every one of the 5 video rows failed with
    Google's "no video generation quota" error. Billing must be enabled on that Google project.
- `place-calls`, `discoverForRun`, `startCalling`, `approveRun`, `runToCsv` and
  `src/lib/sales/sources.ts` are currently unreachable from the UI.
- `campaigns`, `content_items`, `company_facts` tables have no UI.
- `/upgrade` is a price list with no payments. There is no billing, subscription or entitlement
  logic anywhere.
- Release status for Google Play, including what only the owner can do, is tracked in
  `docs/play-store-release-readiness.md`.
- On 2026-10-23 typecheck and lint were both clean and every `test:*` suite passed.

## 21. Things Claude must not break

- RLS policies and the `auth.uid()` scoping.
- Daily AI credits: `chat` and `run-task` cost 1, `generate-image` costs 2, and `save-poster` is free. All use `_shared/ai-credits.ts` and service-only SQL RPCs. The balance is shared per customer and resets after 24 hours. Never replace the server check with a browser counter. See `docs/daily-ai-credits.md`.
- The calling gates listed in §17.7 and the "no tool dials" rule in `chat/index.ts`.
- Server-side prompt resolution (never accept a system prompt from the client).
- `src/lib/supabase.ts` platform storage branch and `detectSessionInUrl` on web only.
- `metro.config.js` package-exports workaround.
- `run-task` and the `tasks`/History flow (explicitly kept even though the chat flow superseded it).
- The auth route guards and `reset-password` living outside the `(auth)` group.

## 22. Rules for changing things

**Modifying existing functionality**
1. Read the file and its comments first — most safety rules are documented at the top of the file.
2. Keep the existing error-message voice and the safety gates.
3. Schema change → new migration file in `supabase/migrations/` *and* apply it *and* update
   `src/types/database.ts`.
4. Changing an Edge Function means redeploying it; the repo and the deployed version can drift.
5. Re-run typecheck, lint and (for web-visible work) the build before claiming done.

**Adding a feature**
1. Data first: table + RLS policies in one migration; mirror the type.
2. Server work goes in an Edge Function if it needs a secret; otherwise use supabase-js from
   `src/lib/`.
3. Screens live under `src/app/(app)/`; shared UI in `src/components/`; data access in `src/lib/`.
4. No new dependency without asking. No fake data, ever.
5. If a provider is not configured, ship the honest empty state rather than a simulation.

## 23. Context-window recovery

If you are picking this up cold or after a compaction:

1. Read this file, then `docs/architecture.md`.
2. `git log --oneline -15` and `git status --short` — recent commits describe intent well.
3. `ls supabase/migrations` for the schema history; the newest file is the current shape.
4. `grep -rn "functions.invoke" src` to see which Edge Functions the app actually calls.
5. Check the live project with the Supabase MCP tools (`list_edge_functions`, `execute_sql`) before
   assuming what is deployed or applied.
6. Never assume a provider is configured — check, or state that it is unverified.
