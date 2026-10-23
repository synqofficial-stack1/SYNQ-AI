// Receives Vapi end-of-call reports. The request is public at the platform
// layer, so the Vapi Bearer credential is checked before reading the payload.
//
// Recovered verbatim from the deployed function (version 8) on 2026-10-22.
// It was deployed without being committed. No screen in src/ starts a Vapi
// call yet, so this only matters once that client exists.
import { createClient } from 'jsr:@supabase/supabase-js@2';

type VapiMessage = {
  type?: string;
  endedReason?: string;
  call?: {
    id?: string;
    metadata?: Record<string, unknown>;
    assistant?: { metadata?: Record<string, unknown> };
    assistantOverrides?: { metadata?: Record<string, unknown> };
    analysis?: { summary?: string; structuredData?: unknown; successEvaluation?: unknown };
    artifact?: { durationSeconds?: number; structuredOutputs?: Record<string, unknown> };
    startedAt?: string;
    endedAt?: string;
  };
  artifact?: {
    transcript?: string;
    messages?: { role?: string; message?: string }[];
    structuredOutputs?: Record<string, unknown>;
  };
};

const json = (body: unknown, status = 200) => Response.json(body, { status });

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function sessionIdFrom(message: VapiMessage): string | null {
  const metadata = [
    message.call?.metadata,
    message.call?.assistantOverrides?.metadata,
    message.call?.assistant?.metadata,
  ];
  for (const entry of metadata) {
    const value = entry?.synq_session_id;
    if (typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)) return value;
  }
  return null;
}

function durationSeconds(message: VapiMessage): number | null {
  const reported = message.call?.artifact?.durationSeconds;
  if (typeof reported === 'number' && Number.isFinite(reported)) return Math.max(0, Math.floor(reported));
  const start = Date.parse(message.call?.startedAt ?? '');
  const end = Date.parse(message.call?.endedAt ?? '');
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? Math.floor((end - start) / 1000)
    : null;
}

function findSummary(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSummary(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^summary$/i.test(key) && typeof child === 'string' && child.trim()) return child.trim();
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findSummary(child, depth + 1);
    if (found) return found;
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const secret = Deno.env.get('VAPI_WEBHOOK_SECRET');
  if (!secret) return json({ error: 'Vapi webhook credential is not configured.' }, 503);
  const authorization = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  if (!constantTimeEqual(authorization, expected)) return json({ error: 'Unauthorized.' }, 401);

  const raw = await request.text();
  if (raw.length > 1_000_000) return json({ error: 'Payload is too large.' }, 413);

  let payload: { message?: VapiMessage };
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON.' }, 400);
  }

  const message = payload.message;
  if (!message || message.type !== 'end-of-call-report') return json({ ok: true, ignored: true });
  const sessionId = sessionIdFrom(message);
  const callId = message.call?.id;
  if (!sessionId || !callId) return json({ error: 'Missing Synq session or Vapi call ID.' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase server credentials are unavailable.' }, 503);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: session, error: lookupError } = await db
    .from('vapi_calls')
    .select('id, provider_call_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (lookupError) return json({ error: 'Could not find the Synq call session.' }, 500);
  if (!session) return json({ error: 'Unknown Synq call session.' }, 404);
  if (session.provider_call_id && session.provider_call_id !== callId) {
    return json({ error: 'Vapi call ID does not match this session.' }, 409);
  }

  const artifact = message.artifact ?? {};
  const analysis = message.call?.analysis;
  const structuredOutput = artifact.structuredOutputs ?? message.call?.artifact?.structuredOutputs ?? {};
  const outcomeValue = analysis?.successEvaluation ?? analysis?.structuredData ?? structuredOutput;
  const outcome = typeof outcomeValue === 'string'
    ? outcomeValue.slice(0, 1000)
    : Object.keys(outcomeValue as object).length
      ? JSON.stringify(outcomeValue).slice(0, 1000)
      : null;
  const { error: updateError } = await db.from('vapi_calls').update({
    provider_call_id: callId,
    status: 'ended',
    transcript: typeof artifact.transcript === 'string'
      ? artifact.transcript.slice(0, 100_000)
      : (artifact.messages ?? []).map((line) => `${line.role ?? 'unknown'}: ${line.message ?? ''}`).join('\n').slice(0, 100_000),
    summary: typeof analysis?.summary === 'string'
      ? analysis.summary.slice(0, 5000)
      : findSummary(structuredOutput)?.slice(0, 5000) ?? null,
    outcome,
    structured_output: structuredOutput,
    ended_reason: message.endedReason?.slice(0, 200) ?? null,
    duration_seconds: durationSeconds(message),
    error_message: /error|failed|timeout/i.test(message.endedReason ?? '')
      ? (message.endedReason ?? '').slice(0, 500)
      : null,
    ended_at: message.call?.endedAt ?? new Date().toISOString(),
  }).eq('id', sessionId);

  if (updateError) return json({ error: 'Could not save the Vapi call report.' }, 500);
  return json({ ok: true });
});
