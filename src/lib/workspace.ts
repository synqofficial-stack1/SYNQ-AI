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
