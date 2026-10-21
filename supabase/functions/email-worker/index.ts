import { createClient } from 'jsr:@supabase/supabase-js@2';
import { processCampaign } from '../_shared/outreach-worker.ts';

async function sameSecret(a: string, b: string) {
  const hash = async (s: string) =>
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)),
    );
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
Deno.serve(async (req) => {
  if (req.method !== 'POST')
    return Response.json({ error: 'Use POST.' }, { status: 405 });
  const configured = Deno.env.get('OUTREACH_WORKER_SECRET');
  const supplied = req.headers.get('x-outreach-worker') || '';
  if (!configured || !supplied || !(await sameSecret(configured, supplied)))
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  // Oldest checked campaign first. Multiple scheduled requests are safe:
  // campaign-level leases serialize send and sync operations.
  const { data, error } = await db
    .from('outreach_campaigns')
    .select('*')
    .eq('status', 'active')
    .order('last_synced_at', { nullsFirst: true })
    .limit(1);
  if (error)
    return Response.json(
      { error: 'Could not load active campaigns.' },
      { status: 503 },
    );
  if (!data?.length) return Response.json({ idle: true });
  try {
    return Response.json(await processCampaign(db, data[0]));
  } catch {
    return Response.json(
      { error: 'Campaign needs attention. See its saved sync error.' },
      { status: 502 },
    );
  }
});
