// Runs one department AI task and records it in `tasks`.
//
// This is the only place the Gemini API key is ever read. It lives as a Supabase
// secret, so it is never in the mobile bundle and never travels to the client.
//
// The client says *which* job to run and supplies the material. It does not
// supply the agent's instructions: those are read from the caller's own
// `departments` row inside this function, chosen by the job's department. A
// client that tries to send its own system prompt is ignored, so no agent's
// behaviour can be rewritten from the app.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const GEMINI_MODEL = 'gemini-3.6-flash';

/**
 * Every job either department can do. The department decides which system
 * prompt is loaded, so adding a job is one entry here plus a JOB section in that
 * department's instructions — no second function, no duplicated plumbing.
 */
type TaskSpec = {
  department: 'sales' | 'marketing';
  instruction: string;
  /** Heading the user's input is filed under in the prompt. */
  inputLabel: string;
  maxTokens: number;
};

const TASK_SPECS: Record<string, TaskSpec> = {
  qualify_lead: {
    department: 'sales',
    instruction: 'Do JOB 1: qualify this lead.',
    inputLabel: 'LEAD',
    maxTokens: 1024,
  },
  draft_outreach_email: {
    department: 'sales',
    instruction: 'Do JOB 2: write the outreach email.',
    inputLabel: 'LEAD',
    maxTokens: 1024,
  },
  draft_call_script: {
    department: 'sales',
    instruction: 'Do JOB 2: write the phone call script.',
    inputLabel: 'LEAD',
    maxTokens: 1024,
  },
  plan_campaign: {
    department: 'marketing',
    instruction: 'Do JOB 1: plan this campaign.',
    inputLabel: 'BRIEF',
    // Eight headed sections; 1024 clipped the plan mid-way.
    maxTokens: 2048,
  },
  draft_content: {
    department: 'marketing',
    instruction: 'Do JOB 2: write this piece of content.',
    inputLabel: 'BRIEF',
    maxTokens: 1536,
  },
  repurpose_content: {
    department: 'marketing',
    instruction: 'Do JOB 3: repurpose this content.',
    inputLabel: 'SOURCE CONTENT',
    maxTokens: 2048,
  },
  content_ideas: {
    department: 'marketing',
    instruction: 'Do JOB 4: generate content ideas.',
    inputLabel: 'BRIEF',
    maxTokens: 1024,
  },
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

  const taskType = String(body.task_type ?? '');
  const spec = TASK_SPECS[taskType];
  if (!spec) {
    return json(
      { error: `Unknown task type. Expected one of: ${Object.keys(TASK_SPECS).join(', ')}.` },
      400
    );
  }

  const { data: department, error: departmentError } = await supabase
    .from('departments')
    .select('id, system_instructions')
    .eq('department_type', spec.department)
    .maybeSingle();

  if (departmentError) return json({ error: departmentError.message }, 500);
  if (!department) {
    return json({ error: `No ${spec.department} department found for this account.` }, 400);
  }

  // Sales jobs may reference a saved lead; everything else works from the text
  // the user typed. Both end up as one labelled block in the prompt.
  let inputBlock: string;
  const leadId = spec.department === 'sales' ? body.lead_id : undefined;
  if (leadId) {
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, name, company, email, phone, notes')
      .eq('id', leadId)
      .maybeSingle();
    if (leadError) return json({ error: leadError.message }, 500);
    if (!lead) return json({ error: 'That lead could not be found.' }, 404);
    inputBlock = describeLead(lead);
  } else {
    const notes = String(body.notes ?? '').slice(0, MAX_NOTES_CHARS).trim();
    if (!notes) {
      return json(
        {
          error:
            spec.department === 'sales'
              ? 'Add some notes about the lead first.'
              : 'Describe what you want before running this.',
        },
        400
      );
    }
    inputBlock = notes;
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
    spec.instruction,
    '',
    spec.inputLabel,
    inputBlock,
    extra ? `\nEXTRA INSTRUCTIONS FROM THE USER\n${extra}` : '',
  ]
    .join('\n')
    .trim();

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        // The key goes in a header, not the query string: URLs end up in access
        // logs and error traces, and a billing key does not belong in either.
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': geminiKey,
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: department.system_instructions }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: userPrompt }],
            },
          ],
          generationConfig: {
            maxOutputTokens: spec.maxTokens,
            temperature: 0.7,
          },
        }),
      }
    );
  } catch {
    return fail('Could not reach Gemini. Please try again.', 502);
  }

  if (!response.ok) {
    // Read Google's own reason so the message names the real problem, but never
    // echo the raw payload back — it can quote the request, key header included.
    let reason = '';
    try {
      const errorBody = await response.json();
      reason = String(errorBody?.error?.message ?? '');
    } catch {
      // Not JSON. The status code alone still tells us enough.
    }

    // Gemini reports a bad or missing key as 400/403, not 401.
    const looksLikeBadKey =
      response.status === 400 || response.status === 403
        ? /api[_ ]?key|api key not valid|permission|unregistered/i.test(reason)
        : false;

    // Google retires model ids on a schedule, so a 404 here is routine rather
    // than exotic. Name the models this key can actually reach: otherwise the
    // only way to find the replacement is to guess one id at a time.
    if (response.status === 404 && !looksLikeBadKey) {
      let available = '';
      try {
        const list = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
          headers: { 'x-goog-api-key': geminiKey },
        });
        if (list.ok) {
          const usable = ((await list.json())?.models ?? [])
            .filter((model: { supportedGenerationMethods?: string[] }) =>
              model?.supportedGenerationMethods?.includes('generateContent')
            )
            .map((model: { name?: string }) => String(model.name ?? '').replace(/^models\//, ''))
            .slice(0, 10);
          if (usable.length) available = ` Models this key can use: ${usable.join(', ')}.`;
        }
      } catch {
        // Best effort — the 404 is still the headline without the list.
      }
      return fail(`Gemini has no model named "${GEMINI_MODEL}".${available}`, 502);
    }

    const hint = looksLikeBadKey
      ? 'Google rejected the API key. Check the GEMINI_API_KEY secret in Supabase for stray spaces or a truncated paste.'
      : response.status === 429
        ? "You've used up the free Gemini allowance for now. Wait a few minutes and try again."
        : `Gemini returned an error (${response.status})${reason ? `: ${reason}` : ''}.`;

    return fail(hint, 502);
  }

  const payload = await response.json();

  // Gemini answers 200 with no candidates when its safety filters block either
  // the prompt or the reply. That is not a crash, and the user deserves to be
  // told which of the two happened rather than shown "empty response".
  const blockedPrompt = payload?.promptFeedback?.blockReason;
  if (blockedPrompt) {
    return fail(
      `Gemini declined to process these notes (reason: ${blockedPrompt}). Try rewording them.`,
      502
    );
  }

  const candidate = payload?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
    return fail(
      `Gemini stopped partway through (reason: ${finishReason}). Try rewording the notes.`,
      502
    );
  }

  const output = (candidate?.content?.parts ?? [])
    .filter((block: { text?: string }) => block?.text)
    .map((block: { text?: string }) => block.text ?? '')
    .join('')
    .trim();

  if (!output) return fail('Gemini returned an empty response. Please try again.', 502);

  const { error: updateError } = await supabase
    .from('tasks')
    .update({ status: 'completed', output, completed_at: new Date().toISOString() })
    .eq('id', task.id);

  if (updateError) return json({ error: updateError.message, task_id: task.id }, 500);

  return json({ task_id: task.id, task_type: taskType, output });
});
