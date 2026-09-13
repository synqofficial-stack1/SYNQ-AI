import { supabase } from '@/lib/supabase';
import { TASK_LABELS, type SalesTaskType } from '@/lib/tasks';

export type ActivityEntry = {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
};

export type WorkspaceSummary = {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  leadCount: number;
  recent: ActivityEntry[];
};

function describeTaskType(taskType: string): string {
  return TASK_LABELS[taskType as SalesTaskType] ?? taskType.replace(/_/g, ' ');
}

/**
 * Everything the dashboard shows comes from here, so the numbers on screen are
 * always the user's own rows rather than placeholders. RLS scopes each query to
 * the signed-in user, so no explicit user filter is needed.
 */
export async function loadWorkspaceSummary(): Promise<WorkspaceSummary> {
  const [tasksResult, leadsResult] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, task_type, status, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('leads').select('id', { count: 'exact', head: true }),
  ]);

  if (tasksResult.error) throw new Error(tasksResult.error.message);

  const tasks = tasksResult.data ?? [];

  return {
    totalRuns: tasks.length,
    completedRuns: tasks.filter((task) => task.status === 'completed').length,
    failedRuns: tasks.filter((task) => task.status === 'failed').length,
    // A failed count query shouldn't take the whole dashboard down with it.
    leadCount: leadsResult.error ? 0 : (leadsResult.count ?? 0),
    recent: tasks.slice(0, 6).map((task) => ({
      id: task.id,
      label: describeTaskType(task.task_type),
      status: task.status,
      createdAt: task.created_at,
    })),
  };
}

export type UsageDay = { key: string; label: string; count: number };
export type UsageStats = {
  days: UsageDay[];
  total: number;
  peak: number;
  breakdown: { label: string; count: number }[];
};

const USAGE_WINDOW_DAYS = 14;

/** Local date key, so a run at 11pm lands on the day the user had it. */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

/**
 * Activity per day over the last fortnight, counted from the user's own rows.
 * There is no analytics service behind this — it is arithmetic over tasks,
 * chat messages and calls, which is why it can only ever report what actually
 * happened.
 */
export async function loadUsage(): Promise<UsageStats> {
  const since = new Date();
  since.setDate(since.getDate() - (USAGE_WINDOW_DAYS - 1));
  since.setHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();

  const [tasksResult, messagesResult, callsResult] = await Promise.all([
    supabase.from('tasks').select('created_at, task_type').gte('created_at', sinceIso),
    supabase
      .from('messages')
      .select('created_at, role, conversations ( kind )')
      .eq('role', 'user')
      .gte('created_at', sinceIso),
    supabase.from('calls').select('created_at').gte('created_at', sinceIso),
  ]);

  if (tasksResult.error) throw new Error(tasksResult.error.message);

  const tasks = tasksResult.data ?? [];
  const messages = (messagesResult.data ?? []) as unknown as {
    created_at: string;
    conversations: { kind: string } | null;
  }[];
  const calls = callsResult.data ?? [];

  const buckets = new Map<string, number>();
  const days: UsageDay[] = [];
  for (let offset = USAGE_WINDOW_DAYS - 1; offset >= 0; offset--) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const key = dayKey(date);
    buckets.set(key, 0);
    days.push({ key, label: String(date.getDate()), count: 0 });
  }

  const tally = (iso: string) => {
    const key = dayKey(new Date(iso));
    if (buckets.has(key)) buckets.set(key, buckets.get(key)! + 1);
  };
  tasks.forEach((row) => tally(row.created_at));
  messages.forEach((row) => tally(row.created_at));
  calls.forEach((row) => tally(row.created_at));

  days.forEach((day) => {
    day.count = buckets.get(day.key) ?? 0;
  });

  const MARKETING_TASKS = ['plan_campaign', 'draft_content', 'repurpose_content', 'content_ideas'];
  const marketingTasks = tasks.filter((t) => MARKETING_TASKS.includes(t.task_type)).length;
  const byKind = (kind: string) =>
    messages.filter((m) => m.conversations?.kind === kind).length;

  const breakdown = [
    { label: 'Sales AI', count: tasks.length - marketingTasks + byKind('sales_ai') },
    { label: 'Marketing AI', count: marketingTasks + byKind('content') + byKind('campaign') },
    { label: 'Workspace assistant', count: byKind('assistant') },
    { label: 'CRM coach', count: byKind('crm') },
    { label: 'Calls logged', count: calls.length },
    // No campaign or content rows here any more: Marketing is a chat, so its
    // activity is already counted as messages above.
  ].filter((row) => row.count > 0);

  const counts = days.map((day) => day.count);
  return {
    days,
    total: counts.reduce((sum, value) => sum + value, 0),
    peak: Math.max(1, ...counts),
    breakdown,
  };
}

export function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
