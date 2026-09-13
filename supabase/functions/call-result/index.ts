// Receives a finished call from the voice provider and writes the result onto
// the prospect row.
//
// This is a public endpoint — ElevenLabs has no Supabase session — so it is
// deployed with verify_jwt off and authenticates by HMAC signature instead. An
// unsigned or badly signed request is rejected before anything is read from it.
// Without that check, anyone who learned the URL could write call outcomes into
// a user's pipeline.
//
// The note and the hot/warm/cold read come from what was actually said. First
// choice is the agent's own data collection fields, if the user configured
// them. Failing that, the real transcript is summarised. Nothing is inferred
// from a call that did not connect: those are recorded as no-answer, not as
// cold leads.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const GEMINI_MODEL = 'gemini-3.6-flash';
/** Reject a signature older than this, so a captured request cannot be replayed. */
const MAX_SIGNATURE_AGE_SECONDS = 30 * 60;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Constant-time comparison. A byte-by-byte early return would leak how much of
 * a forged signature was correct, which is enough to reconstruct it.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Header format is `t=<unix seconds>,v0=<hex hmac of "t.body">`. */
async function signatureValid(header: string | null, rawBody: string, secret: string) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((piece) => {
      const [k, ...rest] = piece.trim().split('=');
      return [k, rest.join('=')];
    })
  );
  const timestamp = Number(parts.t);
  const provided = parts.v0;
  if (!Number.isFinite(timestamp) || !provided) return false;

  const age = Math.abs(Date.now() / 1000 - timestamp);
  if (age > MAX_SIGNATURE_AGE_SECONDS) return false;

  return timingSafeEqual(provided, await hmacHex(secret, `${timestamp}.${rawBody}`));
}

type TranscriptTurn = { role?: string; message?: string | null };

type WebhookPayload = {
  type?: string;
  data?: {
    conversation_id?: string;
    status?: string;
    transcript?: TranscriptTurn[];
    metadata?: { call_duration_secs?: number; termination_reason?: string };
    analysis?: {
      transcript_summary?: string;
      call_successful?: string;
      data_collection_results?: Record<string, { value?: unknown; rationale?: string }>;
    };
    conversation_initiation_client_data?: {
      dynamic_variables?: Record<string, unknown>;
    };
  };
};

const TEMPERATURES = ['hot', 'warm', 'cold'];

/** Pulls a hot/warm/cold answer out of whatever the user named the field. */
function temperatureFromCollection(
  results: Record<string, { value?: unknown }> | undefined
): string | null {
  if (!results) return null;
  for (const [key, entry] of Object.entries(results)) {
    if (!/temperature|interest|lead_quality|qualification/i.test(key)) continue;
    const value = String(entry?.value ?? '').toLowerCase().trim();
    const match = TEMPERATURES.find((t) => value.includes(t));
    if (match) return match;
  }
  return null;
}

function noteFromCollection(
  results: Record<string, { value?: unknown }> | undefined
): string | null {
  if (!results) return null;
  for (const [key, entry] of Object.entries(results)) {
    if (!/summary|note|outcome|next_step/i.test(key)) continue;
    const value = String(entry?.value ?? '').trim();
    if (value) return value;
  }
  return null;
}

/**
 * Last resort: read the real transcript and summarise it. This classifies what
 * was said — it never invents a conversation that did not happen, which is why
 * it is only reached when there is a transcript to read.
 */
async function classify(
  transcript: string,
  geminiKey: string
): Promise<{ note: string; temperature: string | null }> {
  const prompt = `You are reading a transcript of a sales cold call that just happened.

Reply with exactly two lines and nothing else:
NOTE: one sentence, under 20 words, saying what the business said and any next step.
TEMPERATURE: hot, warm, or cold.

hot = they want to buy, book, or meet.
warm = interested but not committed, or asked to be called later.
cold = not interested, or no real engagement.

Only use what is in the transcript. If the transcript shows nobody engaged, say so and mark it cold.

TRANSCRIPT
${transcript.slice(0, 6000)}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
      }),
    }
  );

  if (!response.ok) return { note: 'Call completed. Transcript saved.', temperature: null };

  const body = await response.json();
  const text: string = body?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  const note = text.match(/NOTE:\s*(.+)/i)?.[1]?.trim() ?? 'Call completed. Transcript saved.';
  const rawTemp = text.match(/TEMPERATURE:\s*(\w+)/i)?.[1]?.toLowerCase();
  return {
    note,
    temperature: rawTemp && TEMPERATURES.includes(rawTemp) ? rawTemp : null,
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const secret = Deno.env.get('ELEVENLABS_WEBHOOK_SECRET');
  if (!secret) return json({ error: 'Webhook secret is not configured.' }, 503);

  const rawBody = await req.text();
  const header =
    req.headers.get('ElevenLabs-Signature') ?? req.headers.get('elevenlabs-signature');

  if (!(await signatureValid(header, rawBody, secret))) {
    return json({ error: 'Invalid signature.' }, 401);
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Bad payload.' }, 400);
  }

  if (payload.type && payload.type !== 'post_call_transcription') {
    return json({ ignored: payload.type });
  }

  const data = payload.data ?? {};
  const prospectId = String(data.conversation_initiation_client_data?.dynamic_variables?.prospect_id ?? '');
  if (!prospectId) return json({ error: 'No prospect id on this call.' }, 400);

  // The signature proved this came from the provider, so writes run with the
  // service role — there is no user session on a webhook. Every write below is
  // pinned to the prospect id the provider echoed back, never to a caller-
  // supplied user id.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { data: prospect } = await supabase
    .from('prospects')
    .select('id, user_id, run_id, name, phone, lead_id')
    .eq('id', prospectId)
    .maybeSingle();
  if (!prospect) return json({ error: 'Unknown prospect.' }, 404);

  const turns = (data.transcript ?? []).filter((t) => (t.message ?? '').trim().length > 0);
  const connected = turns.some((t) => t.role === 'user');

  let note: string;
  let temperature: string | null;

  if (!connected) {
    // Nobody picked up, or picked up and said nothing. Calling that a cold lead
    // would be reading a verdict into silence.
    const reason = data.metadata?.termination_reason ?? 'No answer.';
    note = `No answer. ${reason}`.slice(0, 200);
    temperature = null;
  } else {
    temperature = temperatureFromCollection(data.analysis?.data_collection_results);
    note =
      noteFromCollection(data.analysis?.data_collection_results) ??
      data.analysis?.transcript_summary ??
      '';

    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if ((!temperature || !note) && geminiKey) {
      const transcript = turns
        .map((t) => `${t.role === 'user' ? 'Business' : 'Synq'}: ${t.message}`)
        .join('\n');
      const derived = await classify(transcript, geminiKey);
      if (!note) note = derived.note;
      if (!temperature) temperature = derived.temperature;
    }

    if (!note) note = 'Call completed. Transcript saved.';
  }

  await supabase
    .from('prospects')
    .update({
      outreach_status: 'called',
      call_notes: note,
      temperature,
      transcript_summary: data.analysis?.transcript_summary ?? null,
      conversation_id: data.conversation_id ?? null,
      called_at: new Date().toISOString(),
    })
    .eq('id', prospectId);

  // Mirror into the CRM so a called business becomes a real contact with a real
  // call history, reachable from Cold Call and Follow-ups like any other.
  let leadId = prospect.lead_id;
  if (!leadId) {
    const { data: lead } = await supabase
      .from('leads')
      .insert({
        user_id: prospect.user_id,
        name: prospect.name,
        phone: prospect.phone,
        notes: note,
        status: temperature === 'hot' ? 'qualified' : 'contacted',
      })
      .select('id')
      .single();
    leadId = lead?.id ?? null;
    if (leadId) await supabase.from('prospects').update({ lead_id: leadId }).eq('id', prospectId);
  }

  if (leadId) {
    const outcome = !connected
      ? 'no_answer'
      : temperature === 'hot'
        ? 'interested'
        : temperature === 'warm'
          ? 'call_back'
          : 'not_interested';

    await supabase.from('calls').insert({
      user_id: prospect.user_id,
      lead_id: leadId,
      outcome,
      notes: note,
    });
  }

  // A run is done once nothing is still in flight.
  const { count: pending } = await supabase
    .from('prospects')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', prospect.run_id)
    .in('outreach_status', ['pending', 'dialing']);

  if ((pending ?? 0) === 0) {
    await supabase
      .from('sales_runs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', prospect.run_id);
  }

  return json({ ok: true });
});
