// eslint-disable-next-line import/no-unresolved -- This module is resolved by Deno's JSR registry.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { saveCallReport } from '../_shared/call-report.ts';
import { storeRecording } from '../_shared/call-recording.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json' },
});

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'Not signed in.' }, 401);
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization } },
  });
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth.user) return json({ error: 'Not signed in.' }, 401);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad request body.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Bad request body.' }, 400);
  const { data: prospect, error } = await db.from('prospects').select('*')
    .eq('id', String(body.prospect_id ?? '')).eq('user_id', auth.user.id).maybeSingle();
  if (error) return json({ error: 'Could not load this call report.' }, 500);
  if (!prospect) return json({ error: 'That call does not exist.' }, 404);
  if (body.action === 'retry') {
    if (!['called', 'failed'].includes(prospect.outreach_status)) return json({ error: 'The call is still in progress.' }, 409);
    if (!prospect.report_started_at) return json({ error: 'The transcript is not ready yet. Refresh the call first.' }, 409);
    await saveCallReport(db, prospect.id, prospect.call_transcript, prospect.call_duration_seconds);
  } else if (body.action === 'recording') {
    if (!['called', 'failed'].includes(prospect.outreach_status) || !prospect.conversation_id) {
      return json({ error: 'A recording is available after the call finishes.' }, 409);
    }
    // Ownership is proven before service-role storage access.
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    let path: string;
    try { path = await storeRecording(db, prospect); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'Could not open the recording.' }, 502); }
    const { data: link, error: linkError } = await admin.storage.from('call-audio').createSignedUrl(path, 600);
    if (linkError || !link) return json({ error: 'Could not open the recording.' }, 502);
    return json({ url: link.signedUrl });
  } else if (body.action !== 'get') return json({ error: 'Unknown action.' }, 400);
  else if (prospect.report_status === 'processing' && prospect.report_started_at &&
    Date.now() - Date.parse(prospect.report_started_at) > 120_000 && ['called', 'failed'].includes(prospect.outreach_status)) {
    await saveCallReport(db, prospect.id, prospect.call_transcript, prospect.call_duration_seconds);
  }
  const { data: saved, error: savedError } = await db.from('prospects').select('*').eq('id', prospect.id).single();
  if (savedError) return json({ error: 'Could not load this call report.' }, 500);
  return json({ report: saved.call_report, status: saved.report_status, error: saved.report_error,
    transcript: saved.call_transcript, duration: saved.call_duration_seconds,
    recording_error: saved.recording_error, call_error: saved.call_error });
});
