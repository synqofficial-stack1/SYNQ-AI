import { supabase } from '@/lib/supabase';
import type { Task } from '@/types/database';

export const TASK_TYPES = [
  'qualify_lead',
  'draft_outreach_email',
  'draft_call_script',
] as const;
export type SalesTaskType = (typeof TASK_TYPES)[number];

export const TASK_LABELS: Record<SalesTaskType, string> = {
  qualify_lead: 'Qualify this lead',
  draft_outreach_email: 'Draft an email',
  draft_call_script: 'Write a call script',
};

export type RunTaskInput = {
  taskType: SalesTaskType;
  leadId?: string;
  notes?: string;
  extraInstructions?: string;
};

export type RunTaskResult = { taskId: string; output: string };

export class RunTaskError extends Error {}

/**
 * Ask the Sales AI to do one job.
 *
 * All the work happens in the `run-task` Edge Function — the Anthropic key and
 * the agent's system instructions both stay server-side. This only ships the
 * choice of job and the lead.
 */
export async function runTask(input: RunTaskInput): Promise<RunTaskResult> {
  const { data, error } = await supabase.functions.invoke('run-task', {
    body: {
      task_type: input.taskType,
      lead_id: input.leadId,
      notes: input.notes,
      extra_instructions: input.extraInstructions,
    },
  });

  if (error) {
    // supabase-js reports a non-2xx as a generic "Edge Function returned a
    // non-2xx status code" and tucks the real body away on `context`. Dig it out,
    // otherwise the user sees nothing useful.
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json();
        if (body?.error) throw new RunTaskError(body.error);
      } catch (e) {
        if (e instanceof RunTaskError) throw e;
        // Body was not JSON; fall through to the generic wording below.
      }
    }
    // The request never landed at all — usually the function isn't deployed yet.
    if (error.name === 'FunctionsFetchError' || /failed to send/i.test(error.message)) {
      throw new RunTaskError(
        "Couldn't reach the Sales AI service. If this is a fresh setup, the run-task function may not be deployed yet."
      );
    }
    throw new RunTaskError(error.message);
  }

  if (!data?.output) throw new RunTaskError('The agent returned nothing. Please try again.');
  return { taskId: data.task_id, output: data.output };
}

/** Past runs, newest first. RLS limits this to the caller's own rows. */
export async function listTasks(limit = 20): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as Task[];
}
