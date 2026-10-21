# Gmail outreach duties

Sales now opens an email dashboard with campaign history, status counts,
recipient conversations, reply activity, common themes, question coverage, and
reports. **Email duty**, beside **Open AI mode**, opens a separate full-screen
workspace with People, Your brief, and Write & review steps. Back/Continue
controls stay visible at the bottom; closing returns to Sales and preserves
unsaved form inputs while that page remains mounted. Empty campaigns show one
compact getting-started card rather than empty graph panels. `/cold-call` redirects to Sales. Old
call records are preserved; this change does not delete them.

## User flow

1. Open **Email duty** beside **Open AI mode**. Connect Gmail once in the People
   step. This connection is separate from Google sign-in.
2. Enter a campaign name and goal. Add an email with an optional recipient name,
   or choose **Add multiple recipients**. Paste addresses separated by newlines,
   commas, or semicolons. `Name <person@example.com>` is supported. Duplicate
   addresses are removed; a duty supports up to 50 unique people.
3. Add questions (one per line, up to 12), or use **Suggest with AI**. Questions
   are optional when the duty is about other information to include.
4. Add context/instructions and choose a tone. **Draft with AI** produces an
   editable subject and message. Manual writing is also available. `{{name}}`
   becomes the recipient name or “there”. All questions go in one email.
5. **Save & review email** stores a draft without sending. Review the email and
   recipients, check the authorization box, then send. Each address receives a
   separate message, without exposing the other addresses in CC/BCC.
6. SYNQ sends a small queued batch each pass and checks campaign threads in the
   background. The web screen refreshes saved data every 15 seconds. **Sync
   replies** requests a check immediately. **Pause** stops subsequent queued work
   and syncing; a request already accepted by Gmail cannot be recalled.
7. Original replies are stored along with AI summaries, per-question answers,
   sentiment, intent, themes, and next steps. Automatic replies are saved but
   excluded from respondent counts and AI answers. Emails from a different
   sender in the same thread are not attributed to the recipient.
8. **Generate report** works with partial results. Once every person replies, a
   report is generated automatically. Reply analysis continues while summaries
   are pending. Reports refresh as new replies are analyzed. **Export CSV**
   downloads recipient statuses and answers.

**Sent** means Gmail accepted a send request, not confirmed delivery. There is
no open tracking or reliable bounce classification in this version. Response
rate is unique human respondents divided by successfully sent recipients;
received messages and respondents are separate counts. Themes count people,
and one person can mention multiple themes. AI summaries are interpretations;
the original email remains available for comparison.

AI question suggestions, drafting, and a new reply analysis each use **1 shared
AI credit**. Sending, polling, charts, and deterministic report generation do
not spend AI credits. If analysis is unavailable or credits are exhausted,
original replies remain saved and analysis retries on later checks. There are
no automatic follow-up sends. Explicit opt-outs are saved and suppress future
sends by that SYNQ account.

## Gmail setup

Use a Google Cloud **Web application** OAuth client with Gmail API enabled.
Register this exact redirect URI for the configured Supabase project:

```text
https://jjdrlgwpvxyxeruyygli.supabase.co/functions/v1/gmail-auth
```

Set these Supabase Edge Function secrets privately in the dashboard:

- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_TOKEN_ENCRYPTION_KEY`: 32 random bytes represented as 64 hex characters
- `OUTREACH_WORKER_SECRET`: independent random secret for the scheduled checker
- `GMAIL_ALLOWED_ORIGINS`: comma-separated HTTPS app origins for production;
  localhost HTTP origins are allowed for development
- `OUTREACH_AI_MODEL`: optional, defaults to `gemini-2.5-flash`

The existing `GEMINI_API_KEY` and Supabase runtime service-role credentials are
used server-side. Never put Gmail client secrets, refresh tokens, or worker keys
in `EXPO_PUBLIC_*` variables. The Gmail connection uses `gmail.send` and
`gmail.readonly`; the backend fetches only campaign threads, although Google's
permission grants read access to the mailbox. Refresh tokens are encrypted with
AES-GCM, stored in a server-only table, and never returned to the browser.

If the Google consent app is in Testing, add each pilot Gmail account as a test
user. Google's testing refresh-token expiry and restricted-scope verification
rules apply; public customer rollout requires the applicable Google review.
Use a client the project owner controls; a downloaded client from another
project should not be assumed to be the app's active client.

References: [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes),
[sending messages](https://developers.google.com/workspace/gmail/api/guides/sending),
[thread reads](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/get),
[OAuth testing limitations](https://developers.google.com/identity/protocols/oauth2#expiration).

## Deployment

Apply only the reviewed email migrations to the intended project:

- `20261020090000_email_outreach.sql`
- `20261020091000_email_outreach_schedule.sql`

`scripts/setup-email-worker.ps1 -ProjectRef YOUR_PROJECT_REF` creates the two
server keys if missing and puts the checker secret and URL in Supabase Vault.
It does not create OAuth credentials or connect a Gmail account. It writes only
temporary secret files and removes them afterwards. Do not rotate the Gmail
encryption key without re-encrypting tokens or reconnecting accounts.

Deploy `gmail-auth`, `email-outreach`, and `email-worker` with their imported
shared modules. Keep `verify_jwt=false` for `gmail-auth` (callback plus explicit
POST user validation) and `email-worker` (server-only key validation).
`email-outreach` requires the signed-in user's token and reads campaigns through
the caller's RLS. Approved company members can view duties and generate reports;
only the original sender may send, pause, or sync their Gmail duty. See
[Company workspaces](company-workspaces.md) for setup and approval rules.

The `synq-email-replies` pg_cron job runs every minute, invoking the worker via
pg_net with its secret from Vault. No browser needs to remain open. One active
campaign is selected per pass, oldest checked first; a database lease prevents
overlapping work. Polls rotate through up to eight recipient threads per pass,
and up to two changed replies are analyzed. A lease expires after four minutes
if a worker is interrupted. A campaign with many recipients may need several
passes; statuses show the actual queue and most recent sync time.

An interrupted or ambiguous send is marked **Check Gmail Sent**. Reconciliation
searches Gmail for its generated Message-ID; ambiguous emails are never blindly
resent. A failed API send is distinct from an uncertain confirmation. If a
recipient reports an opt-out, no automatic follow-up is sent. No email is sent
from a draft or before explicit campaign approval.

## Verification

- `npm run test:email`: provider-mocked checks for validation, UTF-8 MIME, reply
  extraction, recipient matching, metrics, leases, deduplication, uncertain-send
  recovery, opt-outs, and automatic-reply handling. No emails or paid APIs.
- `supabase/tests/email_outreach.sql`: rollback-only ownership, token-table
  isolation, client-write denial, and lease checks. Creates no lasting users.
- Run TypeScript, scoped lint, and the Expo web export after changes. The full
  repository has unrelated existing React-hook lint errors.
- Once Google OAuth is configured, perform one explicitly authorized pilot
  send to an account you control, reply from that account, and verify the
  original body, summary, counts, report, and export. Provider mocks and a
  successful deployment do not establish successful Gmail delivery or OAuth.
