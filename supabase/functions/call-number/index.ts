// Calls one number with Synq's sales agent, then reads back how it went.
//
// The conversation runs on ElevenLabs. Gemini is the agent's brain and decides
// what to say, ElevenLabs speaks and listens, and Twilio carries the call
// through the number linked to the agent. This function starts the call and,
// when the Sales screen asks, writes the finished conversation onto the call
// sheet. Every state it reports comes from ElevenLabs; nothing here pretends a
// call happened.
//
// Before anything rings, in order:
//
//   1. The caller is signed in. RLS scopes every read and write below to them.
//   2. They confirmed they have permission to call this number.
//   3. It is between 9am and 9pm where they are.
//   4. The number has not asked not to be called again.
//   5. Calling is configured. If it is not, it says so and dials nothing.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const ELEVENLABS = 'https://api.elevenlabs.io';
const GEMINI_MODEL = 'gemini-3.6-flash';

/** India's TCCCPR restricts commercial calls to 09:00–21:00 local time. */
const CALL_WINDOW_START_HOUR = 9;
const CALL_WINDOW_END_HOUR = 21;
/** Asia/Kolkata. Used when the client does not say where it is. */
const DEFAULT_TZ_OFFSET_MINUTES = 330;
const MAX_PITCH_CHARS = 2000;

const TEMPERATURES = ['hot', 'warm', 'cold'] as const;
type Temperature = (typeof TEMPERATURES)[number];

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

const digitsOf = (phone: string) => phone.replace(/[^\d]/g, '');

type Turn = { role?: string; message?: string | null };

type Conversation = {
  status?: string;
  transcript?: Turn[];
  metadata?: { call_duration_secs?: number; termination_reason?: string };
  analysis?: {
    transcript_summary?: string;
    data_collection_results?: Record<string, { value?: unknown }>;
  };
};

type Line = { speaker: 'agent' | 'business'; text: string };

type Outcome = {
  connected: boolean;
  note: string;
  temperature: Temperature | null;
  doNotCall: boolean;
  summary: string | null;
};

type ProspectRow = {
  id: string;
  user_id: string;
  run_id: string;
  phone: string | null;
  lead_id: string | null;
  outreach_status: string;
  conversation_id: string | null;
  call_notes: string | null;
  temperature: Temperature | null;
  transcript_summary: string | null;
  call_error: string | null;
};

/** ElevenLabs's reason for refusing, as a sentence the Sales screen can show. */
function refusal(status: number, payload: unknown): string {
  const detail = (payload as { detail?: unknown })?.detail;
  const message =
    typeof detail === 'string'
      ? detail
      : ((detail as { message?: string })?.message ?? (payload as { message?: string })?.message ?? '');

  if (status === 401) return 'ElevenLabs rejected the API key. Check the ELEVENLABS_API_KEY secret.';
  if (status === 404) {
    return 'ElevenLabs does not recognise the agent or the phone number. Check ELEVENLABS_AGENT_ID and ELEVENLABS_PHONE_NUMBER_ID.';
  }
  return `ElevenLabs could not place the call${message ? `: ${message}` : '.'}`.slice(0, 300);
}

function spoken(conversation: Conversation): Line[] {
  return (conversation.transcript ?? [])
    .filter((turn) => (turn.message ?? '').trim())
    .map((turn) => ({
      speaker: turn.role === 'user' ? 'business' : 'agent',
      text: turn.message!.trim(),
    }));
}

/**
 * Fallback when the agent's own read is missing: read the real transcript. It
 * classifies what was said, and is only reached when something was said.
 */
async function classify(
  transcript: string,
  geminiKey: string
): Promise<{ note: string | null; temperature: Temperature | null }> {
  const prompt = `You are reading a transcript of a sales cold call that just happened.

Reply with exactly two lines and nothing else:
NOTE: one sentence, under 20 words, saying what the business said and any next step.
TEMPERATURE: hot, warm, or cold.

hot = they want to buy, book, or meet.
warm = interested but not committed, or asked to be called later.
cold = not interested, or no real engagement.

Only use what is in the transcript.

TRANSCRIPT
${transcript.slice(0, 6000)}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
        }),
      }
    );
    if (!response.ok) return { note: null, temperature: null };

    const body = await response.json();
    const text: string = body?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const rawTemp = text.match(/TEMPERATURE:\s*(\w+)/i)?.[1]?.toLowerCase();
    return {
      note: text.match(/NOTE:\s*(.+)/i)?.[1]?.trim() ?? null,
      temperature: TEMPERATURES.find((t) => t === rawTemp) ?? null,
    };
  } catch {
    return { note: null, temperature: null };
  }
}

async function readOutcome(conversation: Conversation, lines: Line[]): Promise<Outcome> {
  const connected = lines.some((line) => line.speaker === 'business');
  const summary = conversation.analysis?.transcript_summary?.trim() || null;

  if (!connected) {
    // Nobody picked up, or picked up and said nothing. Calling that a cold lead
    // would be reading a verdict into silence.
    const reason = conversation.metadata?.termination_reason?.trim();
    return {
      connected,
      note: reason ? `No conversation. ${reason}`.slice(0, 200) : 'No answer.',
      temperature: null,
      doNotCall: false,
      summary,
    };
  }

  // Filled in by the agent's data collection fields, set up with the agent.
  const results = conversation.analysis?.data_collection_results ?? {};
  const value = (id: string) => results[id]?.value;

  let temperature =
    TEMPERATURES.find((t) => t === String(value('temperature') ?? '').toLowerCase().trim()) ?? null;
  let note = typeof value('note') === 'string' ? String(value('note')).trim() : '';
  const doNotCall = String(value('do_not_call') ?? '').toLowerCase() === 'true';

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if ((!temperature || !note) && geminiKey) {
    const transcript = lines
      .map((line) => `${line.speaker === 'business' ? 'Business' : 'Synq'}: ${line.text}`)
      .join('\n');
    const derived = await classify(transcript, geminiKey);
    temperature ??= derived.temperature;
    if (!note) note = derived.note ?? '';
  }

  return { connected, note: note || summary || 'Call completed.', temperature, doNotCall, summary };
}

/**
 * Writes a finished call onto its row, closes the run, and mirrors the call
 * into the CRM so the number becomes a contact with a call history.
 */
async function recordResult(db: SupabaseClient, prospect: ProspectRow, outcome: Outcome, failed: boolean) {
  const now = new Date().toISOString();

  // Only from `dialing`: if two checks overlap, the second finds nothing to
  // claim, and the lead and call are not written twice.
  const { data: claimed } = await db
    .from('prospects')
    .update({
      outreach_status: failed ? 'failed' : 'called',
      call_notes: outcome.note.slice(0, 300),
      call_error: failed ? outcome.note.slice(0, 300) : null,
      temperature: outcome.temperature,
      transcript_summary: outcome.summary,
      do_not_call: outcome.doNotCall,
      called_at: now,
    })
    .eq('id', prospect.id)
    .eq('outreach_status', 'dialing')
    .select('id');
  if (!claimed?.length) return;

  await db
    .from('sales_runs')
    .update({ status: 'completed', completed_at: now })
    .eq('id', prospect.run_id);

  if (failed) return;

  let leadId = prospect.lead_id;
  if (!leadId) {
    const { data: lead } = await db
      .from('leads')
      .insert({
        user_id: prospect.user_id,
        name: prospect.phone,
        phone: prospect.phone,
        notes: outcome.note,
        status: outcome.temperature === 'hot' ? 'qualified' : 'contacted',
      })
      .select('id')
      .single();
    leadId = lead?.id ?? null;
    if (leadId) await db.from('prospects').update({ lead_id: leadId }).eq('id', prospect.id);
  }
  if (!leadId) return;

  const callOutcome = !outcome.connected
    ? 'no_answer'
    : outcome.doNotCall || outcome.temperature === 'cold'
      ? 'not_interested'
      : outcome.temperature === 'hot'
        ? 'interested'
        : 'call_back';

  await db.from('calls').insert({
    user_id: prospect.user_id,
    lead_id: leadId,
    outcome: callOutcome,
    notes: outcome.note,
  });
}

async function startCall(
  db: SupabaseClient,
  userId: string,
  body: { phone?: string; pitch?: string; confirmed?: boolean; tz_offset_minutes?: number }
) {
  const phone = String(body.phone ?? '').replace(/[\s()-]/g, '');
  if (!/^\+\d{8,15}$/.test(phone)) {
    return json({ error: 'Enter the number with + and the country code, like +919876543210.' }, 400);
  }
  const pitch = String(body.pitch ?? '').trim().slice(0, MAX_PITCH_CHARS);
  if (!pitch) return json({ error: 'Tell the agent what it is selling first.' }, 400);

  // Gate 2.
  if (body.confirmed !== true) {
    return json({ error: 'Confirm you have permission to call this number.' }, 403);
  }

  // Gate 3. Computed in the caller's local time, not the server's.
  const offset = Number.isFinite(body.tz_offset_minutes)
    ? Number(body.tz_offset_minutes)
    : DEFAULT_TZ_OFFSET_MINUTES;
  const localHour = new Date(Date.now() + offset * 60_000).getUTCHours();
  if (localHour < CALL_WINDOW_START_HOUR || localHour >= CALL_WINDOW_END_HOUR) {
    return json({ error: 'Calls only go out between 9am and 9pm. Try again in the morning.' }, 409);
  }

  // Gate 4. Only an explicit "don't call me again" blocks a number for good.
  const { data: blocked } = await db.from('prospects').select('phone').eq('do_not_call', true);
  if ((blocked ?? []).some((row) => row.phone && digitsOf(row.phone) === digitsOf(phone))) {
    return json({ error: 'This number asked not to be called again, so Synq will not call it.' }, 403);
  }

  // Gate 5.
  const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
  const agentId = Deno.env.get('ELEVENLABS_AGENT_ID');
  const phoneNumberId = Deno.env.get('ELEVENLABS_PHONE_NUMBER_ID');
  const missing = [
    !apiKey && 'ELEVENLABS_API_KEY',
    !agentId && 'ELEVENLABS_AGENT_ID',
    !phoneNumberId && 'ELEVENLABS_PHONE_NUMBER_ID',
  ].filter(Boolean);
  if (missing.length > 0) {
    return json(
      { error: `Calling integration not configured. Add ${missing.join(', ')} to the Supabase Edge Function secrets.` },
      503
    );
  }

  // The call gets a run and a prospect row, so it lands on the call sheet and
  // the dashboard like any other.
  const now = new Date().toISOString();
  const { data: run, error: runError } = await db
    .from('sales_runs')
    .insert({
      user_id: userId,
      request: `Call ${phone}`,
      pitch,
      target_count: 1,
      source: 'manual',
      status: 'calling',
      attested_at: now,
      provider: 'elevenlabs',
      calls_placed: 1,
    })
    .select('id')
    .single();
  if (runError || !run) return json({ error: runError?.message ?? 'Could not save the call.' }, 500);

  const { data: prospect, error: prospectError } = await db
    .from('prospects')
    .insert({
      user_id: userId,
      run_id: run.id,
      name: phone,
      phone,
      source: 'manual',
      eligibility: 'eligible',
      eligibility_reason: 'Entered by you, with permission confirmed.',
      outreach_status: 'dialing',
    })
    .select('id')
    .single();
  if (prospectError || !prospect) {
    const reason = prospectError?.message ?? 'Could not save the call.';
    await db.from('sales_runs').update({ status: 'failed', blocked_reason: reason }).eq('id', run.id);
    return json({ error: reason }, 500);
  }

  const fail = async (reason: string) => {
    await db.from('prospects').update({ outreach_status: 'failed', call_error: reason }).eq('id', prospect.id);
    await db.from('sales_runs').update({ status: 'blocked', blocked_reason: reason }).eq('id', run.id);
    return json({ error: reason }, 502);
  };

  let response: Response;
  try {
    response = await fetch(`${ELEVENLABS}/v1/convai/twilio/outbound-call`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agentId,
        agent_phone_number_id: phoneNumberId,
        to_number: phone,
        conversation_initiation_client_data: {
          // The agent's prompt reads {{pitch}}. The ids tie the finished call
          // back to its row.
          dynamic_variables: { pitch, prospect_id: prospect.id, run_id: run.id, business_name: phone },
        },
      }),
    });
  } catch {
    return fail('Could not reach ElevenLabs.');
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return fail(refusal(response.status, payload));
  if (!payload.success || !payload.conversation_id) {
    return fail(`The call did not go through: ${payload.message ?? 'no reason given'}`.slice(0, 300));
  }

  await db
    .from('prospects')
    .update({ conversation_id: payload.conversation_id, provider_call_id: payload.callSid ?? null })
    .eq('id', prospect.id);

  return json({ prospect_id: prospect.id, run_id: run.id, state: 'ringing' });
}

async function callStatus(db: SupabaseClient, prospectId: string) {
  if (!prospectId) return json({ error: 'Which call is this?' }, 400);

  const { data } = await db
    .from('prospects')
    .select(
      'id, user_id, run_id, phone, lead_id, outreach_status, conversation_id, call_notes, temperature, transcript_summary, call_error'
    )
    .eq('id', prospectId)
    .maybeSingle();
  if (!data) return json({ error: 'That call does not exist.' }, 404);
  const prospect = data as ProspectRow;

  if (prospect.outreach_status !== 'dialing') {
    return json({
      state: prospect.outreach_status === 'failed' ? 'failed' : 'done',
      note: prospect.call_notes,
      temperature: prospect.temperature,
      summary: prospect.transcript_summary,
      error: prospect.call_error,
      transcript: [],
    });
  }
  if (!prospect.conversation_id) return json({ state: 'ringing', transcript: [] });

  const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
  if (!apiKey) {
    return json({ error: 'Calling integration not configured. Add ELEVENLABS_API_KEY to the Supabase secrets.' }, 503);
  }

  let conversation: Conversation;
  try {
    const response = await fetch(
      `${ELEVENLABS}/v1/convai/conversations/${encodeURIComponent(prospect.conversation_id)}`,
      { headers: { 'xi-api-key': apiKey } }
    );
    // Right after dialling, the conversation may not exist on their side yet.
    if (response.status === 404) return json({ state: 'ringing', transcript: [] });
    if (!response.ok) {
      return json({ error: refusal(response.status, await response.json().catch(() => ({}))) }, 502);
    }
    conversation = await response.json();
  } catch {
    return json({ error: 'Could not reach ElevenLabs.' }, 502);
  }

  const transcript = spoken(conversation);
  switch (conversation.status) {
    case 'in-progress':
      return json({ state: 'talking', transcript });
    case 'processing':
      return json({ state: 'wrapping_up', transcript });
    case 'done':
    case 'failed':
      break;
    default:
      return json({ state: 'ringing', transcript });
  }

  const outcome = await readOutcome(conversation, transcript);
  const failed = conversation.status === 'failed' && !outcome.connected;
  await recordResult(db, prospect, outcome, failed);

  return json({
    state: failed ? 'failed' : 'done',
    note: outcome.note,
    temperature: outcome.temperature,
    summary: outcome.summary,
    error: failed ? outcome.note : null,
    transcript,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Not signed in.' }, 401);

  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  });

  // Gate 1.
  const { data: userData, error: userError } = await db.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ error: 'Not signed in.' }, 401);

  let body: {
    action?: string;
    phone?: string;
    pitch?: string;
    confirmed?: boolean;
    tz_offset_minutes?: number;
    prospect_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request body.' }, 400);
  }

  if (body.action === 'start') return startCall(db, user.id, body);
  if (body.action === 'status') return callStatus(db, String(body.prospect_id ?? ''));
  return json({ error: 'Unknown action.' }, 400);
});
