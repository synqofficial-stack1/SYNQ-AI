# Synq AI — status and roadmap

A status sheet, not a promise list. Every line is either evidenced by the repository or marked
**Unknown / needs verification**. Code status originally reviewed 2026-09-21 (branch `redesign`);
Supabase migration and Auth setup rechecked 2026-10-08.

## Supabase account migration — 2026-10-08

- The app now points to the active `SYNQ AI` project `jjdrlgwpvxyxeruyygli` using its public
  publishable key in the ignored `.env.local` file.
- All repository migrations through `20260921000000_platform_events.sql`, plus two security
  hardening migrations, have been applied. All 15 public tables have RLS enabled.
- The app's nine current Edge Function endpoints are deployed. Runtime secrets still need to be
  configured in the new project's Edge Function settings.
- Email/password sign-up is enabled and requires email confirmation. Google sign-in is disabled
  until the new Google OAuth client is configured in Supabase Auth.
- The project started empty; no old users or application data were copied. Current records show
  two profiles and two signup events, indicating that app accounts have been created since setup.
- Security Advisor's remaining finding is disabled leaked-password protection. Enable it before
  public launch; custom SMTP and Auth redirect/site URLs also need production values.

## Built and working in code

- Auth: email/password sign-up and sign-in, Google OAuth code path, password reset request and
  reset screen, route guards, session context.
- Dashboard with real counts and a 14-day activity chart derived from the user's own rows.
- Sales: single-number AI calling (`call-number` + the Sales screen), recent-calls sheet,
  hot/warm/cold reads, do-not-call flag, CRM mirroring into `leads` and `calls`.
- Manual cold-call queue with `tel:` dialing and outcome logging; follow-ups; CSV/spreadsheet lead
  import.
- Marketing brainstorming chat and Veo video generation with cost confirmation and private
  storage.
- Department agents with server-side prompts and read-only tools.
- Row-level security on every table, plus a runnable isolation test.

### CEO Control Center (`/ceo`) — added 2026-09-21

Company overview, accounts, AI workforce, 30-day usage, live activity feed (polled every 15s),
errors and alerts, integration health, security and access, global search and per-account
drill-down. Restricted to `app_admins` and enforced by the `admin-console` Edge Function, not by
hiding the route. Backed by the new `events` table, which is the first history Synq has ever kept.

Three panels are deliberately empty, with the reason and the missing data source named on screen:
revenue/billing (no payment provider), organizations (no org table — one account is one
workspace), automations (no scheduler).

## Built but not reachable from the UI

- Whole-list calling: `discover-prospects` (Google Places), `sales_runs`/`prospects` list flow,
  `approveRun`/`startCalling` in `src/lib/sales/runs.ts`, `place-calls`, and the `call-result`
  webhook. The Sales screen currently shows only the single-number panel.
- `src/lib/sales/sources.ts` (prospect source registry) — imported by nothing.
- `runToCsv` export helper.

## Schema without a feature

- `campaigns`, `content_items` (marketing CRUD) — no code touches them.
- `company_facts` (business knowledge base intended to feed pitches) — no code touches them.

## Placeholder

- `/upgrade`: hardcoded plan tiers. The screen itself states there is no payment provider. There is
  no billing, subscription, or entitlement logic anywhere.

## Not started

Automations/scheduling, third-party integrations (CRM, email, calendar, social), notifications,
a settings screen, teams/multi-user workspaces, mobile push, offline support, tests beyond the SQL
RLS script.

## External blockers (**secret presence verified 2026-09-21** by the CEO console's health check)

The console reads only whether a secret is *present* — never its value — and pairs that with what
happened last time Synq used the provider.

| Blocker | Effect | Status |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` set as a Supabase secret (+ "Places API (New)" enabled) | Business discovery returns nothing | **Not set.** Confirmed blocker |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_AGENT_ID` / `ELEVENLABS_PHONE_NUMBER_ID` set | No call can be placed at all | **None of the three are set.** Confirmed blocker |
| Paid Twilio account with a number imported into ElevenLabs | Calls fail even once the secrets exist | Unknown / needs verification (outside the repo and the database) |
| Google billing enabled for the Gemini/Veo key | Veo has no free tier | **Confirmed blocker.** All 5 video rows failed with Google's "no video generation quota" error |
| Google provider enabled in Supabase Auth | "Continue with Google" reports it is switched off | **Done 2026-09-22.** `external.google: true`; the button reaches Google's sign-in screen against a Web-application client |
| `ELEVENLABS_WEBHOOK_SECRET` + webhook configured in ElevenLabs | Batch-call results never arrive | Moot until the three `ELEVENLABS_*` secrets above exist |

Gemini itself is fine: `GEMINI_API_KEY` is set and the most recent call succeeded.

## Repo/live drift to clean up

- `social-auth` and `social-post` are still deployed on Supabase but were deleted from the repo in
  `5f6bf52`. Nothing calls them.
- `call-audio` function and bucket remain from the Twilio playback experiment; used only by
  `scripts/twilio-test-call.js`.
- Launcher icon, splash and Android adaptive icons are still Expo template artwork.
- Lint reports ~14 pre-existing problems (mostly `react-hooks/set-state-in-effect`) in older
  screens. Typecheck and the web build are clean.

## Sensible next steps (suggestions, not commitments)

1. Decide whether the list-calling path returns to the Sales screen or gets removed.
2. Replace the Expo template icons with the Synq mark (a transparent PNG would also let the login
   screen show the wordmark as designed).
3. Either wire `company_facts` into the calling pitch or drop the table.
4. Add Synq branding assets and a real background image for the auth screens.
5. Clear the pre-existing lint warnings in the older screens.
