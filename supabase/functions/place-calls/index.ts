// Hands an approved run's numbers to the voice provider.
//
// This is the only place in Synq that causes a phone to ring, so it is the
// place where every gate is enforced rather than assumed. In order:
//
//   1. The caller is signed in and the run is theirs (RLS).
//   2. The run carries an `attested_at` — a person looked at this list and
//      confirmed it. A run without one is refused outright, whatever the model
//      or the client asks for.
//   3. It is between 9am and 9pm where the user is.
//   4. Only prospects the screener marked eligible and has not already dialled.
//
// Failing any of these returns a reason, not a partial dial. There is no code
// path here that places a call on a run the user has not approved.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const BATCH_ENDPOINT = 'https://api.elevenlabs.io/v1/convai/batch-calling/submit';

/** India's TCCCPR restricts commercial calls to 09:00–21:00 local time. */
const CALL_WINDOW_START_HOUR = 9;
const CALL_WINDOW_END_HOUR = 21;
/** Asia/Kolkata. Used when the client does not say where it is. */
const DEFAULT_TZ_OFFSET_MINUTES = 330;
/** A single run cannot dial more than this, whatever it asks for. */
const MAX_CALLS_PER_RUN = 50;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** E.164 is what the provider requires; anything else is rejected before dialling. */
function toE164(phone: string, defaultCountry = '91'): string | null {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/[^\d]/g, '');
    return digits.length >= 8 ? `+${digits}` : null;
  }
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length < 8) return null;
  // A bare 10-digit Indian mobile or landline, as Google often returns it.
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  return `+${digits}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Not signed in.' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ error: 'Not signed in.' }, 401);

  let body: { run_id?: string; tz_offset_minutes?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request body.' }, 400);
  }

  const runId = String(body.run_id ?? '');
  if (!runId) return json({ error: 'Which run is this for?' }, 400);

  const { data: run } = await supabase
    .from('sales_runs')
    .select('id, request, pitch, objective, target_count, attested_at, status')
    .eq('id', runId)
    .maybeSingle();
  if (!run) return json({ error: 'That run does not exist.' }, 404);

  // Gate 2. The one that must never be relaxed for convenience.
  if (!run.attested_at) {
    return json(
      { error: 'This list has not been approved yet. Review it and confirm before any calls go out.' },
      403
    );
  }

  // Gate 3. Computed in the user's local time, not the server's.
  const offset = Number.isFinite(body.tz_offset_minutes)
    ? Number(body.tz_offset_minutes)
    : DEFAULT_TZ_OFFSET_MINUTES;
  const localHour = new Date(Date.now() + offset * 60_000).getUTCHours();
  if (localHour < CALL_WINDOW_START_HOUR || localHour >= CALL_WINDOW_END_HOUR) {
    return json(
      { error: 'Outside the 9am–9pm calling window. The list is saved and can go out in the morning.' },
      409
    );
  }

  const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
  const agentId = Deno.env.get('ELEVENLABS_AGENT_ID');
  const phoneNumberId = Deno.env.get('ELEVENLABS_PHONE_NUMBER_ID');

  const missing = [
    !apiKey && 'ELEVENLABS_API_KEY',
    !agentId && 'ELEVENLABS_AGENT_ID',
    !phoneNumberId && 'ELEVENLABS_PHONE_NUMBER_ID',
  ].filter(Boolean);

  if (missing.length > 0) {
    const reason = `Calling is not connected. Missing ${missing.join(', ')} in the Supabase secrets. The number must be linked to the ElevenLabs agent through Twilio or Exotel first.`;
    await supabase
      .from('sales_runs')
      .update({ status: 'blocked', blocked_reason: reason })
      .eq('id', runId);
    return json({ error: reason }, 503);
  }

  // Gate 4.
  const { data: prospects } = await supabase
    .from('prospects')
    .select('id, name, phone')
    .eq('run_id', runId)
    .eq('eligibility', 'eligible')
    .eq('outreach_status', 'pending')
    .limit(Math.min(run.target_count ?? MAX_CALLS_PER_RUN, MAX_CALLS_PER_RUN));

  const queue = prospects ?? [];
  if (queue.length === 0) {
    return json({ error: 'Nothing left to call on this run.' }, 409);
  }

  const recipients = [];
  const dialing: string[] = [];
  const unreachable: string[] = [];

  for (const prospect of queue) {
    const e164 = prospect.phone ? toE164(prospect.phone) : null;
    if (!e164) {
      unreachable.push(prospect.id);
      continue;
    }
    recipients.push({
      phone_number: e164,
      conversation_initiation_client_data: {
        dynamic_variables: {
          // How the webhook finds its way back to this row. Without it a
          // finished call has no home and the result is lost.
          prospect_id: prospect.id,
          run_id: runId,
          business_name: prospect.name,
          pitch: run.pitch ?? run.objective ?? run.request,
        },
      },
    });
    dialing.push(prospect.id);
  }

  if (unreachable.length > 0) {
    await supabase
      .from('prospects')
      .update({ outreach_status: 'skipped', call_error: 'Phone number is not dialable.' })
      .in('id', unreachable);
  }

  if (recipients.length === 0) {
    return json({ error: 'None of the numbers on this run can be dialled.' }, 409);
  }

  let batchId: string | null = null;
  try {
    const response = await fetch(BATCH_ENDPOINT, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call_name: `Synq run ${runId.slice(0, 8)}`,
        agent_id: agentId,
        agent_phone_number_id: phoneNumberId,
        scheduled_time_unix: Math.floor(Date.now() / 1000),
        recipients,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      let reason = `The calling provider refused the batch (${response.status}).`;
      if (response.status === 401) {
        reason = 'ElevenLabs rejected the API key. Check the ELEVENLABS_API_KEY secret.';
      } else if (response.status === 404) {
        reason = 'ElevenLabs does not recognise that agent or phone number id. Check both secrets.';
      } else if (response.status === 422) {
        reason = `ElevenLabs rejected the request: ${detail.slice(0, 300)}`;
      }
      await supabase
        .from('sales_runs')
        .update({ status: 'blocked', blocked_reason: reason })
        .eq('id', runId);
      return json({ error: reason }, 502);
    }

    batchId = (await response.json())?.id ?? null;
  } catch {
    const reason = 'Could not reach the calling provider.';
    await supabase
      .from('sales_runs')
      .update({ status: 'blocked', blocked_reason: reason })
      .eq('id', runId);
    return json({ error: reason }, 502);
  }

  await supabase.from('prospects').update({ outreach_status: 'dialing' }).in('id', dialing);

  await supabase
    .from('sales_runs')
    .update({
      status: 'calling',
      blocked_reason: null,
      provider: 'elevenlabs',
      provider_batch_id: batchId,
      calls_placed: dialing.length,
    })
    .eq('id', runId);

  return json({
    queued: dialing.length,
    skipped: unreachable.length,
    batch_id: batchId,
  });
});
