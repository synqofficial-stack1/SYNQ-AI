// One turn of a conversation with a department's AI, persisted to `messages`.
//
// Replaces the one-shot `run-task` flow: the client sends a message and a
// conversation id, and gets the model's reply plus the whole thread back. The
// Gemini key and every system prompt stay server-side — the client picks a
// `kind`, never a prompt, so no agent's behaviour can be rewritten from the app.
//
// The dashboard assistant (`kind: 'assistant'`) additionally gets tools. Those
// are deliberately narrow: reads over the caller's own rows, plus starting a
// sales run, which builds a list and stops. Nothing can publish, delete, alter
// a lead, or place a call.

import { readAIModeInput } from '../_shared/ai-mode-input.ts';
import { aiModeInstructions } from '../_shared/ai-mode.ts';
import { withAICredits } from '../_shared/ai-credits.ts';

// eslint-disable-next-line import/no-unresolved -- Deno resolves the JSR registry.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const GEMINI_MODEL = 'gemini-3.6-flash';
const MAX_OUTPUT_TOKENS = 2048;
const MAX_MESSAGE_CHARS = 8000;
/** How many prior turns to replay. Keeps the request bounded on long threads. */
const HISTORY_LIMIT = 40;
/** Stops a confused model looping tools until the daily quota is gone. */
const MAX_TOOL_CALLS = 5;

const KINDS = ['assistant', 'sales_ai', 'crm', 'content', 'campaign'] as const;
type Kind = (typeof KINDS)[number];

/** Which `departments` row holds the system prompt for each kind. */
const DEPARTMENT_FOR: Record<Kind, string> = {
  assistant: 'workspace',
  sales_ai: 'sales',
  crm: 'sales_crm',
  content: 'marketing',
  campaign: 'marketing',
};

/**
 * Which tools each agent may call. Absent means no tools at all, which is the
 * case for the marketing kinds: they brainstorm, and brainstorming needs no
 * access to anyone's rows.
 *
 * The CRM coach gets reads over the caller's own contacts and nothing else — it
 * advises on who to call, so it has no reason to start a run or write anything.
 */
const TOOLS_FOR: Partial<Record<Kind, string[]>> = {
  assistant: [
    'get_workspace_summary',
    'list_leads',
    'list_follow_ups',
    'start_sales_run',
    'check_run_status',
    'navigate',
  ],
  crm: ['get_workspace_summary', 'list_leads', 'list_follow_ups'],
  sales_ai: ['get_workspace_summary', 'list_leads', 'start_sales_run', 'check_run_status'],
};

// Worth stating plainly, because it is the line the whole calling design rests
// on: there is no tool here that places a phone call. `start_sales_run` builds a
// list and stops. Dialling happens in `place-calls`, which refuses any run
// without an `attested_at`, and only the approve button on the Sales screen
// writes that column. No sequence of model outputs can reach a phone.

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

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const PAGES: Record<string, string> = {
  dashboard: '/',
  activity: '/history',
  'sales ai': '/sales',
  crm: '/import-leads',
  'cold call': '/cold-call',
  'follow-ups': '/follow-ups',
  marketing: '/marketing',
};

const TOOL_DECLARATIONS = [
  {
    name: 'get_workspace_summary',
    description:
      'Counts across the whole workspace: contacts, calls logged, follow-ups due. Use this for any "how many" question.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_leads',
    description:
      'Contacts in the CRM, newest first. Set uncalled_only to see just the ones with no call logged yet.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many to return, at most 25.' },
        uncalled_only: { type: 'boolean', description: 'Only contacts never called.' },
      },
    },
  },
  {
    name: 'list_follow_ups',
    description: 'Scheduled callbacks with their dates, soonest first.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'start_sales_run',
    description:
      'Find real local businesses on Google Maps and build a call sheet from them. Use this when the user asks to find businesses to call, or to run outreach in an area. It searches, screens the numbers, and stops with the list waiting for the user to approve — it does NOT place any calls. Ask for the location first if you do not have one; never guess it.',
    parameters: {
      type: 'object',
      properties: {
        industry: {
          type: 'string',
          description: 'The kind of business, e.g. "salons", "dental clinics", "restaurants".',
        },
        location: {
          type: 'string',
          description: 'City or area to search. Required — ask the user if they have not said.',
        },
        count: { type: 'number', description: 'How many businesses to find, at most 20.' },
        pitch: {
          type: 'string',
          description: 'One or two sentences on what is being sold, for the calling agent to use.',
        },
      },
      required: ['location'],
    },
  },
  {
    name: 'check_run_status',
    description:
      'How the most recent calling run is going: how many were found, how many called, and the hot/warm/cold split.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'navigate',
    description:
      'Offer the user a button to a page. Pass one of: dashboard, activity, sales ai, crm, cold call, follow-ups, marketing.',
    parameters: {
      type: 'object',
      properties: { page: { type: 'string' } },
      required: ['page'],
    },
  },
];

type ToolOutcome = { result: Record<string, unknown>; navigateTo?: string };

async function runTool(
  supabase: SupabaseClient,
  userId: string,
  name: string,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  switch (name) {
    case 'get_workspace_summary': {
      const [leads, calls, followUps] = await Promise.all([
        supabase.from('leads').select('id', { count: 'exact', head: true }),
        supabase.from('calls').select('id', { count: 'exact', head: true }),
        supabase
          .from('calls')
          .select('id', { count: 'exact', head: true })
          .not('follow_up_on', 'is', null),
      ]);
      return {
        result: {
          contacts: leads.count ?? 0,
          calls_logged: calls.count ?? 0,
          follow_ups_scheduled: followUps.count ?? 0,
        },
      };
    }

    case 'list_leads': {
      const limit = Math.min(Number(args.limit ?? 10) || 10, 25);
      const { data: leads } = await supabase
        .from('leads')
        .select('id, name, company, phone, status')
        .order('created_at', { ascending: false })
        .limit(limit);

      let rows = leads ?? [];
      if (args.uncalled_only) {
        const { data: called } = await supabase.from('calls').select('lead_id');
        const calledIds = new Set((called ?? []).map((c) => c.lead_id));
        rows = rows.filter((lead) => !calledIds.has(lead.id));
      }
      return { result: { count: rows.length, leads: rows } };
    }

    case 'list_follow_ups': {
      const { data } = await supabase
        .from('calls')
        .select('id, outcome, follow_up_on, leads ( name, company )')
        .not('follow_up_on', 'is', null)
        .order('follow_up_on', { ascending: true })
        .limit(25);
      return { result: { count: (data ?? []).length, follow_ups: data ?? [] } };
    }

    case 'start_sales_run': {
      const location = String(args.location ?? '').trim();
      if (!location) {
        return {
          result: {
            error: 'A location is needed before I can search. Ask the user which city or area.',
          },
        };
      }

      const industry = args.industry ? String(args.industry).trim() : null;
      const count = Math.min(Math.max(Number(args.count ?? 20) || 20, 1), 20);

      const { data: run, error: runError } = await supabase
        .from('sales_runs')
        .insert({
          user_id: userId,
          request: `Find ${count} ${industry ?? 'businesses'} in ${location}`,
          industry,
          location,
          pitch: args.pitch ? String(args.pitch) : null,
          target_count: count,
          status: 'planning',
        })
        .select('id')
        .single();

      if (runError) return { result: { error: runError.message } };

      // Discovery runs in its own function because that is where the Places key
      // lives. A failure there is reported back as text, not thrown — the model
      // needs to tell the user what went wrong.
      const { data: outcome, error: discoverError } = await supabase.functions.invoke(
        'discover-prospects',
        { body: { run_id: run.id, industry, location, limit: count } }
      );

      if (discoverError) {
        const response = (discoverError as { context?: Response }).context;
        let reason = 'Google Maps search did not run.';
        if (response && typeof response.json === 'function') {
          try {
            const parsed = await response.json();
            if (parsed?.error) reason = parsed.error;
          } catch {
            // Not JSON. Keep the generic reason.
          }
        }
        return { result: { error: reason, run_id: run.id } };
      }

      return {
        result: {
          run_id: run.id,
          found: outcome?.found ?? 0,
          eligible: outcome?.eligible ?? 0,
          excluded: outcome?.excluded ?? 0,
          searched: outcome?.query ?? null,
          status: 'awaiting_approval',
          note: 'The list is built and nothing has been dialled. Tell the user to open Sales and press the call button to approve it. You cannot start the calls yourself.',
        },
      };
    }

    case 'check_run_status': {
      const { data: run } = await supabase
        .from('sales_runs')
        .select('id, request, status, blocked_reason, calls_placed, location, industry')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!run) return { result: { note: 'No calling run has been started yet.' } };

      const { data: prospects } = await supabase
        .from('prospects')
        .select('outreach_status, temperature, eligibility')
        .eq('run_id', run.id);

      const rows = prospects ?? [];
      const called = rows.filter((r) => r.outreach_status === 'called');

      return {
        result: {
          request: run.request,
          status: run.status,
          blocked_reason: run.blocked_reason,
          found: rows.length,
          eligible: rows.filter((r) => r.eligibility === 'eligible').length,
          called: called.length,
          hot: called.filter((r) => r.temperature === 'hot').length,
          warm: called.filter((r) => r.temperature === 'warm').length,
          cold: called.filter((r) => r.temperature === 'cold').length,
          no_answer: called.filter((r) => !r.temperature).length,
        },
      };
    }

    case 'navigate': {
      const page = String(args.page ?? '').toLowerCase().trim();
      const path = PAGES[page];
      if (!path) {
        return { result: { error: `No page called "${page}". Options: ${Object.keys(PAGES).join(', ')}.` } };
      }
      // The server never navigates — it hands the destination back and the
      // client decides whether to render a button.
      return { result: { offered: page }, navigateTo: path };
    }

    default:
      return { result: { error: `No tool called ${name}.` } };
  }
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

type GeminiPart = {
  inlineData?: { mimeType: string; data: string };
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: unknown };
};
type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] };

class GeminiError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

async function callGemini(
  key: string,
  systemInstruction: string,
  contents: GeminiContent[],
  tools: typeof TOOL_DECLARATIONS
): Promise<GeminiPart[]> {
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        // Key in a header, never the query string: URLs end up in access logs.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents,
          ...(tools.length ? { tools: [{ functionDeclarations: tools }] } : {}),
          generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.7 },
        }),
      }
    );
  } catch {
    throw new GeminiError('Could not reach Gemini. Please try again.');
  }

  if (!response.ok) {
    let reason = '';
    try {
      reason = String((await response.json())?.error?.message ?? '');
    } catch {
      // Not JSON; the status alone still tells us enough.
    }

    // Gemini reports a bad or missing key as 400/403, not 401.
    const looksLikeBadKey =
      response.status === 400 || response.status === 403
        ? /api[_ ]?key|api key not valid|permission|unregistered/i.test(reason)
        : false;

    // Model ids get retired on a schedule, so name the ones that do work rather
    // than leaving the next person to guess one id at a time.
    if (response.status === 404 && !looksLikeBadKey) {
      let available = '';
      try {
        const list = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
          headers: { 'x-goog-api-key': key },
        });
        if (list.ok) {
          const usable = ((await list.json())?.models ?? [])
            .filter((m: { supportedGenerationMethods?: string[] }) =>
              m?.supportedGenerationMethods?.includes('generateContent')
            )
            .map((m: { name?: string }) => String(m.name ?? '').replace(/^models\//, ''))
            .slice(0, 10);
          if (usable.length) available = ` Models this key can use: ${usable.join(', ')}.`;
        }
      } catch {
        // Best effort — the 404 is still the headline.
      }
      throw new GeminiError(`Gemini has no model named "${GEMINI_MODEL}".${available}`);
    }

    if (looksLikeBadKey) {
      throw new GeminiError(
        'Google rejected the API key. Check the GEMINI_API_KEY secret in Supabase for stray spaces or a truncated paste.'
      );
    }
    if (response.status === 429) {
      throw new GeminiError(
        "You've used up the free Gemini allowance for now. Wait a few minutes and try again."
      );
    }
    throw new GeminiError(
      `Gemini returned an error (${response.status})${reason ? `: ${reason}` : ''}.`
    );
  }

  const payload = await response.json();

  const blocked = payload?.promptFeedback?.blockReason;
  if (blocked) {
    throw new GeminiError(`Gemini declined to answer (reason: ${blocked}). Try rewording that.`);
  }

  const candidate = payload?.candidates?.[0];
  if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'RECITATION') {
    throw new GeminiError(
      `Gemini stopped partway through (reason: ${candidate.finishReason}). Try rewording that.`
    );
  }

  return (candidate?.content?.parts ?? []) as GeminiPart[];
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) return json({ error: 'The server is missing its GEMINI_API_KEY secret.' }, 500);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'You are signed out. Log in and try again.' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ error: 'You are signed out. Log in and try again.' }, 401);

  let body: {
    action?: string;
    conversation_id?: string;
    kind?: string;
    context?: Record<string, unknown>;
    message?: string;
    attachments?: unknown;
    initial_history?: unknown;
    work_context?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Malformed request.' }, 400);
  }

  if (!body || typeof body !== 'object') return json({ error: 'Malformed request.' }, 400);
  if (body.action === 'ai-mode-capabilities') return json({ ai_mode_version: 2 });
  let aiInput: ReturnType<typeof readAIModeInput>;
  try { aiInput = readAIModeInput(body); } catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid files.' }, 400); }

  const message = String(body.message ?? '').slice(0, MAX_MESSAGE_CHARS).trim();
  if (!message) return json({ error: 'Type something first.' }, 400);

  const kind = String(body.kind ?? '') as Kind;
  if (!KINDS.includes(kind)) {
    return json({ error: `Unknown chat kind. Expected one of: ${KINDS.join(', ')}.` }, 400);
  }

  const { data: department, error: departmentError } = await supabase
    .from('departments')
    .select('id, system_instructions')
    .eq('department_type', DEPARTMENT_FOR[kind])
    .maybeSingle();

  if (departmentError) return json({ error: departmentError.message }, 500);
  if (!department) {
    return json({ error: `This account has no ${DEPARTMENT_FOR[kind]} agent configured.` }, 400);
  }

  return withAICredits(user.id, 'chat', async () => {
  // Resolve the thread. RLS means a conversation_id belonging to someone else
  // simply is not found.
  let conversationId = body.conversation_id;
  if (conversationId) {
    const { data: existing } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('kind', kind)
      .maybeSingle();
    if (!existing) return json({ error: 'That conversation could not be found.' }, 404);
  } else {
    const { data: created, error: createError } = await supabase
      .from('conversations')
      .insert({
        user_id: user.id,
        department_id: department.id,
        kind,
        title: message.slice(0, 60),
        context: body.context ?? {},
      })
      .select('id')
      .single();
    if (createError) return json({ error: createError.message }, 500);
    conversationId = created.id;
    if (aiInput.history.length) {
      const start = Date.now() - aiInput.history.length - 1;
      const { error: importError } = await supabase.from('messages').insert(aiInput.history.map((turn, index) => ({ conversation_id: conversationId, user_id: user.id, role: turn.role, content: turn.content, created_at: new Date(start + index).toISOString() })));
      if (importError) return json({ error: 'Could not restore the earlier messages. Please try again.' }, 500);
    }
  }

  const { data: history, error: historyError } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (historyError) return json({ error: historyError.message }, 500);

  const { error: saveUserError } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    user_id: user.id,
    role: 'user',
    content: message,
  });
  if (saveUserError) return json({ error: saveUserError.message }, 500);

  const contents: GeminiContent[] = [
    ...(history ?? []).reverse().map((m) => ({
      role: m.role as 'user' | 'model',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: message + (aiInput.context ? '\n\n<recent_work_context>\n' + aiInput.context + '\n</recent_work_context>' : '') }, ...aiInput.parts] },
  ];

  const allowed = TOOLS_FOR[kind] ?? [];
  const tools = TOOL_DECLARATIONS.filter((tool) => allowed.includes(tool.name));
  const navigations: string[] = [];

  let reply = '';
  try {
    let toolCalls = 0;
    for (;;) {
      const parts = await callGemini(geminiKey, department.system_instructions + (body.context?.ai_mode === true ? aiModeInstructions(kind) : ''), contents, tools);
      const calls = parts.filter((p) => p.functionCall);

      if (calls.length === 0 || toolCalls >= MAX_TOOL_CALLS) {
        reply = parts
          .filter((p) => p.text)
          .map((p) => p.text)
          .join('')
          .trim();
        break;
      }

      // Echo the model's own turn back before answering it, or the next request
      // has a function response with nothing to respond to.
      contents.push({ role: 'model', parts });

      const responses: GeminiPart[] = [];
      for (const part of calls) {
        toolCalls++;
        const call = part.functionCall!;
        // Filtering the declarations only tells the model what exists; this is
        // what enforces it. A model that asks for a tool this agent doesn't have
        // gets told no rather than having it run.
        if (!allowed.includes(call.name)) {
          responses.push({
            functionResponse: {
              name: call.name,
              response: { error: 'That tool is not available in this conversation.' },
            },
          });
          continue;
        }
        const outcome = await runTool(supabase, user.id, call.name, call.args ?? {});
        if (outcome.navigateTo) navigations.push(outcome.navigateTo);
        responses.push({ functionResponse: { name: call.name, response: outcome.result } });
      }
      contents.push({ role: 'user', parts: responses });
    }
  } catch (e) {
    const error = e instanceof GeminiError ? e.message : 'Something went wrong. Please try again.';
    return json({ error, conversation_id: conversationId }, 502);
  }

  if (!reply) return json({ error: 'The AI returned an empty reply. Please try again.', conversation_id: conversationId }, 502);

  const { error: saveModelError } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    user_id: user.id,
    role: 'model',
    content: reply,
  });
  if (saveModelError) return json({ error: saveModelError.message }, 500);

  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  return json({
    conversation_id: conversationId,
    reply,
    navigations: [...new Set(navigations)],
  });
  });
});
