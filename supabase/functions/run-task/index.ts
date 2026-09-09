// Runs one Sales AI task and records it in `tasks`.
//
// This is the only place the Gemini API key is ever read. It lives as a Supabase
// secret, so it is never in the mobile bundle and never travels to the client.
//
// The client says *which* job to run and supplies the lead. It does not supply
// the agent's instructions: those are read from the caller's own `departments`
// row inside this function. A client that tries to send its own system prompt is
// ignored, so the agent's behaviour cannot be rewritten from the app.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const GEMINI_MODEL = 'gemini-2.0-flash';
const MAX_TOKENS = 1024;

/** Jobs the Sales AI is allowed to do. Anything else is rejected. */
const TASK_TYPES = ['qualify_lead', 'draft_outreach_email', 'draft_call_script'] as const;
type TaskType = (typeof TASK_TYPES)[number];

const INSTRUCTION_FOR: Record<TaskType, string> = {
  qualify_lead: 'Do JOB 1: qualify this lead.',
  draft_outreach_email: 'Do JOB 2: write the outreach email.',
  draft_call_script: 'Do JOB 2: write the phone call script.',
};

// Caps so one request cannot run up an unbounded bill.
const MAX_NOTES_CHARS = 8000;
const MAX_EXTRA_CHARS = 1000;

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

/** Describe the lead using only the fields we actually hold. */
function describeLead(lead: Record<string, unknown>): string {
  const lines = (
    [
      ['Name', lead.name],
      ['Company', lead.company],
      ['Email', lead.email],
      ['Phone', lead.phone],
    ] as const
  )
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);

  const notes = String(lead.notes ?? '').slice(0, MAX_NOTES_CHARS).trim();
  lines.push(`Notes:\n${notes || '(no notes recorded)'}`);
  return lines.join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) {
    return json({ error: 'The server is missing its GEMINI_API_KEY secret.' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'You are signed out. Log in and try again.' }, 401);

  // Built with the caller's own token, so every query below runs under their RLS
  // policies — this function cannot reach another user's leads even by mistake.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ error: 'You are signed out. Log in and try again.' }, 401);

  let body: { task_type?: string; lead_id?: string; notes?: string; extra_instructions?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Malformed request.' }, 400);
  }

  const taskType = body.task_type as TaskType;
  if (!TASK_TYPES.includes(taskType)) {
    return json({ error: `Unknown task type. Expected one of: ${TASK_TYPES.join(', ')}.` }, 400);
  }

  const { data: department, error: departmentError } = await supabase
    .from('departments')
    .select('id, system_instructions')
    .eq('department_type', 'sales')
    .maybeSingle();

  if (departmentError) return json({ error: departmentError.message }, 500);
  if (!department) {
    return json({ error: 'No Sales AI department found for this account.' }, 400);
  }

  // Either work from a saved lead, or from notes typed straight into the app.
  let leadDescription: string;
  const leadId = body.lead_id;
  if (leadId) {
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, name, company, email, phone, notes')
      .eq('id', leadId)
      .maybeSingle();
    if (leadError) return json({ error: leadError.message }, 500);
    if (!lead) return json({ error: 'That lead could not be found.' }, 404);
    leadDescription = describeLead(lead);
  } else {
    const notes = String(body.notes ?? '').slice(0, MAX_NOTES_CHARS).trim();
    if (!notes) return json({ error: 'Add some notes about the lead first.' }, 400);
    leadDescription = `Notes:\n${notes}`;
  }

  const extra = String(body.extra_instructions ?? '').slice(0, MAX_EXTRA_CHARS).trim();

  // Record the attempt before calling out, so a failure leaves a trace the user
  // can see rather than vanishing.
  const { data: task, error: insertError } = await supabase
    .from('tasks')
    .insert({
      user_id: user.id,
      department_id: department.id,
      task_type: taskType,
      input: { lead_id: leadId ?? null, notes: body.notes ?? null, extra_instructions: extra || null },
      status: 'running',
    })
    .select('id')
    .single();

  if (insertError) return json({ error: insertError.message }, 500);

  const fail = async (message: string, status: number) => {
    await supabase
      .from('tasks')
      .update({ status: 'failed', output: message, completed_at: new Date().toISOString() })
      .eq('id', task.id);
    return json({ error: message, task_id: task.id }, status);
  };

  const userPrompt = [
    INSTRUCTION_FOR[taskType],
    '',
    'LEAD',
    leadDescription,
    extra ? `\nEXTRA INSTRUCTIONS FROM THE USER\n${extra}` : '',
  ]
    .join('\n')
    .trim();

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: { text: department.system_instructions },
          },
          contents: [
            {
              parts: [{ text: userPrompt }],
            },
          ],
          generationConfig: {
            maxOutputTokens: MAX_TOKENS,
          },
        }),
      }
    );
  } catch {
    return fail('Could not reach Gemini. Please try again.', 502);
  }

  if (!response.ok) {
    // Surface a useful hint without ever echoing the key or raw provider payload.
    const hint =
      response.status === 401
        ? 'Gemini rejected the API key. Check the GEMINI_API_KEY secret in Supabase.'
        : response.status === 429
          ? 'Gemini is rate limiting this account. Wait a moment and try again.'
          : `Gemini returned an error (${response.status}).`;
    return fail(hint, 502);
  }

  const payload = await response.json();
  const output = (payload?.candidates?.[0]?.content?.parts ?? [])
    .filter((block: { text?: string }) => block?.text)
    .map((block: { text?: string }) => block.text ?? '')
    .join('')
    .trim();

  if (!output) return fail('Gemini returned an empty response.', 502);

  const { error: updateError } = await supabase
    .from('tasks')
    .update({ status: 'completed', output, completed_at: new Date().toISOString() })
    .eq('id', task.id);

  if (updateError) return json({ error: updateError.message, task_id: task.id }, 500);

  return json({ task_id: task.id, task_type: taskType, output });
});
