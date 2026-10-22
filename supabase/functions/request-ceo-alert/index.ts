import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'Sign in first.' }, 401);

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data, error } = await caller.auth.getUser();
  if (error || !data.user) return json({ error: 'Sign in again.' }, 401);

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  const { data: recent, error: queryError } = await db.from('events')
    .select('id')
    .eq('user_id', data.user.id)
    .eq('kind', 'settings.failure_alert_requested')
    .gte('created_at', cutoff)
    .limit(1);
  if (queryError) return json({ error: 'Could not check recent alerts.' }, 500);
  if (recent?.length) return json({ ok: true, alreadySent: true });

  const { error: insertError } = await db.from('events').insert({
    user_id: data.user.id,
    source: 'settings',
    kind: 'settings.failure_alert_requested',
    severity: 'warning',
    summary: 'A user requested a CEO review of a failure.',
  });
  if (insertError) return json({ error: 'Could not send the CEO alert.' }, 500);
  return json({ ok: true });
});
