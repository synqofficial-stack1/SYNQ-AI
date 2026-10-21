# Daily AI credits

Each signed-in customer starts with **50 credits per rolling 24 hours**, shared across all departments, conversations, browsers and devices. The first charged request starts the window. After it expires the balance is available again; the next request starts a new window. This is not a midnight reset. Existing conversations/images are not charged retroactively.

- Chat prompts, including PDF/photo analysis and legacy department tasks: **1 credit**.
- Image generation, including the background for a poster: **2 credits**.
- Opening history, reading usage, filling in the poster form, and saving the finished poster: **0 credits**.
- Editing/resending a prompt or generating another image is a new request.
- A failed provider request, empty reply, or failed server-side save refunds its charge. A successfully generated background costs 2 even if later browser poster composition fails. Stopping the browser's wait does not cancel a completed server generation.
- Calls, call reports, and videos retain their existing behavior; they are not included in this prompt allowance.

Balances live in Postgres. Browser storage, changing `clientId`, opening a new chat, or sending a client-selected cost cannot reset or lower a charge. The server uses the user validated by Supabase Auth. A row lock makes checking the balance and deducting credits atomic. Refund receipts are idempotent and tied to their original window so delayed failures cannot increase a new window's balance.

The UI shows remaining credits, per-action costs and a reset timestamp in the customer's local time. It refreshes after requests, on focus, periodically, and at the web reset time. When only 1 credit remains the customer can still chat; an image is declined without a provider request. Upgrade links open `/upgrade`.

## Activate in Supabase

1. Run **`supabase/migrations/20261013090000_ai_daily_credits.sql`** once in the SQL Editor for the same project the app uses.
2. Redeploy **`chat`**, **`generate-image`** and **`run-task`**, including their shared dependencies. All three now import **`supabase/functions/_shared/ai-credits.ts`**. Existing `chat` dependencies `_shared/ai-mode.ts` and `_shared/ai-mode-input.ts` are still required. Updating only the browser cannot enforce the allowance.
3. Refresh localhost. No new API secret is needed; the functions use Supabase's existing service-role runtime secret to manage credits.

From the `SYNQ-AI-main` folder, the Supabase CLI includes imported shared files automatically:

```powershell
npx supabase login
npx supabase functions deploy chat --project-ref jjdrlgwpvxyxeruyygli
npx supabase functions deploy generate-image --project-ref jjdrlgwpvxyxeruyygli
npx supabase functions deploy run-task --project-ref jjdrlgwpvxyxeruyygli
```

Use the intended project's reference if it differs from this repository's configured project. The SQL step is separate; these deploy commands do not apply migrations. If using the dashboard editor, include the shared files and preserve the relative import paths. Do not deploy only a new `index.ts` without its imports.

Until the migration and functions are deployed, the hosted backend still behaves as its old version. The new functions fail closed if usage storage is unavailable. Deploy all three to avoid leaving an older prompt entry point without the check.

## Plans and administration

The free allowance and upgrade prompts are implemented. Paid checkout is not connected, and paid credit quantities have not been specified. The plans page presents planned upgrades without activating a paid plan or making an unlimited-use promise. A trusted billing backend can later update `ai_credit_accounts.credit_limit`; authenticated customers cannot update it. No client or user-editable profile field grants more credits.

Handled failures retry the refund once. If the database remains unavailable, the function logs the debit receipt ID for reconciliation. An abruptly terminated Edge Function can also leave a charged receipt; the operator can inspect it and call `refund_ai_credits` using service-role access. Do not refund based only on age because a successful request may already have produced an image/reply. The next 24-hour window is independent.

## Validation

Run `npm run test:credits`, `npm run test:ai-mode`, and `npm run test:calls` for mocked Edge Function tests. They make no provider requests.

`supabase/tests/ai_daily_credits.sql` contains rollback-only database checks for the 49/50-credit boundary, refund idempotency, 24-hour rollover, late refunds and isolation. Run it in a test project with a test customer after the migration. The file also describes the two-session concurrency check. These database checks require Postgres and are separate from the mocked Node tests.
