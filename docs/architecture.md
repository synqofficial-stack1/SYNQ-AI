# Synq AI — architecture

Verified against the repository on 2026-09-21. Facts marked **Unknown / needs verification** could
not be established from the code.

## 1. Shape of the system

```
Expo app (iOS / Android / web)
  │  supabase-js  ── Postgres (RLS)            ← all reads/writes of the user's own rows
  │  functions.invoke ── Supabase Edge Functions (Deno)
  │                        ├── Gemini  (text, call analysis)
  │                        ├── Veo     (video)
  │                        ├── Google Places (business discovery)
  │                        └── ElevenLabs Conversational AI → Twilio (voice calls)
  └── Supabase Storage (private buckets: videos, call-audio)
```

There is no application server, no Next.js, no API routes, no server actions and no middleware.
Every secret-bearing call happens inside an Edge Function.

## 2. Routes (expo-router, `src/app/`)

| Route | File | Purpose |
|---|---|---|
| `/` | `app/index.tsx` | Redirects to `/(app)` or `/(auth)/login` based on session |
| `/(auth)/login` | `(auth)/login.tsx` | Email/password + Google, forgot-password link |
| `/(auth)/signup` | `(auth)/signup.tsx` | Email/password + Google |
| `/(auth)/forgot-password` | `(auth)/forgot-password.tsx` | Sends the reset email |
| `/reset-password` | `app/reset-password.tsx` | Sets a new password. Outside `(auth)` because that group redirects sessions away, and a recovery link *is* a session |
| `/(app)` | `(app)/index.tsx` | Dashboard |
| `/(app)/sales` | `(app)/sales.tsx` | Sales department |
| `/(app)/cold-call` | `(app)/cold-call.tsx` | Manual dialer queue |
| `/(app)/follow-ups` | `(app)/follow-ups.tsx` | Callbacks due |
| `/(app)/import-leads` | `(app)/import-leads.tsx` | CSV / spreadsheet import |
| `/(app)/marketing` | `(app)/marketing.tsx` | Marketing chat + video |
| `/(app)/upgrade` | `(app)/upgrade.tsx` | Price list (no payments) |
| `/(app)/history`, `/(app)/history/[id]` | `(app)/history/` | Past `tasks` runs |
| `/(app)/ceo` | `(app)/ceo.tsx` | **CEO Control Center — admins only.** The sidebar hides it for everyone else; the real gate is server-side (below) |

Layouts: `app/_layout.tsx` (SessionProvider + ThemeProvider + Stack) → `(app)/_layout.tsx` (guard +
`AppShell` + `Slot`) and `(auth)/_layout.tsx` (guard + Stack).

## 3. Edge Functions (`supabase/functions/`)

| Function | JWT | What it does | Secrets |
|---|---|---|---|
| `chat` | required | One conversation turn for a department agent; loads the prompt from the caller's `departments` row; tool calling for the dashboard assistant and Sales AI | `GEMINI_API_KEY` |
| `run-task` | required | Older one-shot task runner; writes `tasks` rows read by History | `GEMINI_API_KEY` |
| `discover-prospects` | required | Google Places text search, screening, inserts `prospects` | `GOOGLE_PLACES_API_KEY` |
| `place-calls` | required | Batch calls a whole approved run via ElevenLabs batch calling | `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_PHONE_NUMBER_ID` |
| `call-number` | required | Single-number call: `action: 'start'` and `action: 'status'`; writes the result | `ELEVENLABS_*`, `GEMINI_API_KEY` |
| `call-result` | **off** | ElevenLabs post-call webhook, authenticated by HMAC signature | `ELEVENLABS_WEBHOOK_SECRET`, `GEMINI_API_KEY`, service role |
| `generate-video` | required | Veo `start`/`check`, downloads the result into Storage | `GEMINI_API_KEY`, `VEO_MODEL`, service role |
| `call-audio` | required | Stores one mp3 in the private `call-audio` bucket, returns a signed URL; gated by a SHA-256-checked token header | service role |
| `admin-console` | required | Whole-platform data for `/ceo`: `snapshot`, `feed`, `search`, `user`. Refuses with 403 unless the caller has an `app_admins` row | service role |

Deployed-but-not-in-repo (verified live 2026-09-21): `social-auth`, `social-post`. Dead.

### The CEO console's authorization

`/ceo` is the only screen that reads other people's rows, so it is the only one that cannot rely on
RLS. Two gates, both inside `admin-console/index.ts`, in this order:

1. **Session** — the caller's `Authorization` header is verified with the anon client's
   `auth.getUser()`. No header or a bad one ⇒ `401`.
2. **Admin row** — `app_admins` is read *with the service-role key*, so the answer cannot be
   influenced by the caller's own policies, headers or role claims. No row ⇒ `403`, with the same
   message for every action and nothing about what exists behind it.

Only after both does a service-role client read across users. Three consequences worth keeping:

- `isAdmin()` in `src/lib/admin.ts` decides whether to *show* the nav item. It grants nothing. A
  non-admin who types `/ceo` gets the same 403, rendered as "Not authorized".
- The console returns **activity, never content**: counts, statuses, timings, error text. No message
  bodies, prompts, transcripts or task inputs/outputs. Lead phone numbers are masked to two digits.
- Integration health reads `Deno.env.get(NAME)` only to test *presence*; no secret value is read,
  returned or logged.

Opening the console writes an `admin.console_viewed` event, rate-limited to one per 10 minutes so
the feed is not flooded by its own polling.

## 3b. Enabling Google sign-in

Status on 2026-09-22: **on**. `GET /auth/v1/settings` reports `external.google: true`,
`/auth/v1/authorize?provider=google` answers `302` to
`accounts.google.com/o/oauth2/v2/auth` with `redirect_uri` set to this project's
`/auth/v1/callback`, and clicking the button reaches Google's real sign-in screen. The steps below
are what was done, kept for when it needs redoing (a new environment, a rotated secret).

`signInWithGoogle()` pre-checks that settings endpoint before redirecting, because
`signInWithOAuth` builds the Google URL locally and navigates straight to it — a disabled provider
would otherwise land the user on a page of raw JSON. The check fails open: if it cannot run, the
sign-in proceeds and the real flow reports what happens.

**1. Google Cloud — a *Web application* client.** The `*credentials*.json` file in the project
root is an `"installed"` (Desktop app) client, whose only allowed redirect is `http://localhost`.
Supabase needs its own hosted callback, which a Desktop client cannot register, so that file is
**not** the one in use and can be deleted. In the same Google Cloud project, create
*APIs & Services → Credentials → Create credentials → OAuth client ID → **Web application***, with:

| Field | Value |
|---|---|
| Authorised redirect URI | `https://jjdrlgwpvxyxeruyygli.supabase.co/auth/v1/callback` |

If the OAuth consent screen is in **Testing**, only accounts added under *Audience → Test users*
can sign in; publish it to let anyone in.

**2. Supabase — turn the provider on.** Dashboard → *Authentication → Providers → Google*: enable
it and paste that Web client's Client ID and Client secret. This is the only place those values
belong; never commit them (`.gitignore` blocks `*credentials*.json` and `client_secret*.json`).

**3. Supabase — allow the addresses the app comes back to.** Dashboard →
*Authentication → URL Configuration → Redirect URLs*. Without these, Supabase ignores `redirectTo`
and sends the user to the Site URL instead — the usual "it worked but I ended up on a dead page":

| Where | Value |
|---|---|
| Web, dev | `http://localhost:8082/**` |
| Web, dev (second server) | `http://localhost:8083/**` |
| Native (scheme from `app.json`) | `synqai://**` |
| Web, production | the deployed origin + `/**` |

**4. Verify.** `curl "$SUPABASE_URL/auth/v1/settings" -H "apikey: $ANON"` should show
`"google": true`, after which the button completes a real sign-in. A first Google sign-in creates
an `auth.users` row, so `handle_new_user` seeds the profile and the four departments exactly as an
email sign-up does.

## 4. Chat and agent tooling

`src/components/chat-panel.tsx` → `src/lib/chat.ts` → `chat` function.

- Kinds: `assistant`, `sales_ai`, `crm`, `content`, `campaign` (`CHAT_KINDS` in `src/lib/chat.ts`,
  matching the `conversations.kind` check constraint).
- The function maps kind → `departments.department_type`: `assistant→workspace`, `sales_ai→sales`,
  `crm→sales_crm`, `content|campaign→marketing`, and uses that row's `system_instructions`.
- Tools (`chat/index.ts`): `get_workspace_summary`, `list_leads`, `list_follow_ups`,
  `start_sales_run`, `check_run_status`, `navigate`. `start_sales_run` builds a list by invoking
  `discover-prospects` and stops. **No tool places a call, edits a lead, or publishes anything.**

## 5. Sales pipeline as built

**Single number (what the Sales screen uses)**

```
sales.tsx  → runs.callNumber()  → call-number (start)
                                    gates: session, permission tick, 9am–9pm, do_not_call, secrets
                                    creates sales_runs + prospects rows
                                    ElevenLabs /v1/convai/twilio/outbound-call
sales.tsx  → runs.checkCall()   → call-number (status)  → polls the ElevenLabs conversation
                                    on done/failed: writes call_notes, temperature,
                                    transcript_summary, do_not_call, promotes a lead,
                                    inserts a calls row, completes the run
```

**Whole list (built, currently unreachable from the UI)**

```
chat(start_sales_run) → discover-prospects → prospects rows (screened)
user approval sets sales_runs.attested_at   (approveRun in runs.ts)
runs.startCalling() → place-calls → ElevenLabs batch calling → call-result webhook writes results
```

## 6. Marketing pipeline

`marketing.tsx` renders one `ChatPanel` (`kind="campaign"`, `enableVideo`). `video-actions.tsx`
calls `src/lib/videos.ts` → `generate-video`:

- `start` writes a `videos` row **before** calling Veo (every attempt is billed), stores
  `operation_name`.
- `check` polls; on success downloads the file with the server-side key and puts it in the private
  `videos` bucket; the client plays it through a signed URL.
- The UI states the cost and requires a second, deliberate press.

## 7. CRM / leads

- Import: `file-drop.tsx` (web only; spreadsheets converted with `xlsx`) or pasted CSV →
  `src/lib/csv.ts` (hand-written RFC 4180 reader) → `src/lib/leads.ts` (column aliases, preview,
  insert).
- Manual calling: `/cold-call` builds a queue from leads with phone numbers (`src/lib/calls.ts`),
  dials through `tel:` (`src/lib/telephony.ts`, native only), logs a `calls` row; a database trigger
  syncs `leads.status` from the outcome.
- Follow-ups: `calls.follow_up_on` dates, rendered by `/follow-ups`.

## 7b. Platform events

`public.events` is the only history in Synq. It is written by AFTER triggers on `tasks`, `videos`,
`calls`, `leads`, `sales_runs`, `prospects`, `conversations` and `profiles` — never by application
code, so no feature has to remember to log and no existing code path changed when it was added.
Every trigger body ends in `exception when others then return null`, and `log_event` swallows its
own failures too: a broken audit trail must not fail a user's write.

Users read their own events through RLS; admins read all of them. Nobody can insert — there is no
insert policy, so the log cannot be forged from a session (proved by
`supabase/tests/admin_access_test.sql`).

The rows that predate the table were backfilled from the existing row timestamps and carry
`meta->>'backfilled' = 'true'`; the console labels those "from history" rather than implying they
were captured live.

## 8. Analytics

`src/lib/workspace.ts` only. `loadWorkspaceSummary()` counts the user's `tasks` and `leads`;
`loadUsage()` buckets `tasks`, user `messages` and `calls` into the last 14 local days and derives a
breakdown. No analytics vendor, no event pipeline, no demo data.

## 9. Client/server boundary rules

- Client may read/write its own rows directly (RLS enforces ownership) and invoke Edge Functions.
- Client must never hold a provider key or a system prompt.
- Web is prerendered (`web.output: "static"`), so nothing may touch `window` at module scope.
- Long jobs are polled from the client; only `call-result` accepts an inbound webhook.

## 10. Developer scripts (`scripts/`)

Node CLI tools, not part of the app bundle: `twilio-test-call.js` (ElevenLabs TTS → `call-audio`
hosting → Twilio playback), `generate-speech.js`, `agent-call.js` (two-way ElevenLabs agent call,
can link a Twilio number), `lib/env.js` (reads `.env.local`), `reset-project.js` (Expo template
helper). They read developer keys from `.env.local` and are unrelated to runtime behaviour.
