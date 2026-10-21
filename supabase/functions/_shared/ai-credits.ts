// eslint-disable-next-line import/no-unresolved -- Deno resolves JSR imports.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers });

/** Call only after validating the user's JWT and request. Costs are resolved in SQL. */
export async function withAICredits(userId: string, operation: 'chat' | 'image', work: () => Promise<Response>): Promise<Response> {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey) return json({ error: 'AI usage needs the server storage secret configured.' }, 503);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  let reservation;
  try { reservation = await admin.rpc('reserve_ai_credits', { p_user_id: userId, p_operation: operation }); }
  catch { return json({ error: 'Could not check your credits. Please try again.' }, 503); }
  const { data: usage, error } = reservation;
  if (error || !usage || typeof usage.allowed !== 'boolean') return json({ error: 'AI usage is unavailable. Apply the daily credits migration and try again.' }, 503);
  if (!usage.allowed) {
    return json({ ...usage, code: 'AI_CREDIT_LIMIT', upgrade_url: '/upgrade',
      error: operation === 'image'
        ? `An image needs 2 credits; you have ${usage.remaining} left. Wait for your 24-hour reset or upgrade for more credits and added benefits.`
        : 'You have used your credits for this 24-hour period. Wait for the reset or upgrade for more credits and added benefits.',
    }, 402);
  }
  if (!usage.debit_id) return json({ error: 'Could not reserve credits. Please try again.' }, 503);
  let result: Response;
  try { result = await work(); }
  catch { result = json({ error: 'The AI request failed. Please try again.' }, 502); }
  if (!result.ok) {
    // Refunds are idempotent. Retry a transient database failure once.
    let refunded = false;
    for (let attempt = 0; attempt < 2 && !refunded; attempt++) {
      try { refunded = !(await admin.rpc('refund_ai_credits', { p_debit_id: usage.debit_id })).error; } catch { /* Retry once. */ }
    }
    if (!refunded) console.error('AI credit refund needs reconciliation', usage.debit_id);
  }
  return result;
}
