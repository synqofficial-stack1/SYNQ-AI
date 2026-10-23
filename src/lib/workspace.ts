import { MARKETING_TASK_TYPES, TASK_LABELS, type AnyTaskType } from '@/lib/tasks';
import { SOCIAL_LABELS, type SocialPlatform } from '@/lib/social';
import { supabase } from '@/lib/supabase';

// Everything the dashboard shows comes from here, so the numbers on screen are
// always the person's own rows rather than placeholders. RLS scopes each query
// to the signed-in user (and, for shared company tables, to their company), so
// no explicit user filter is needed. There is no analytics service behind any
// of it — it is arithmetic over rows that actually exist.

export type DashboardRange = 7 | 14 | 30;

export type DashboardDay = {
  key: string;
  label: string;
  sales: number;
  marketing: number;
  company: number;
  total: number;
};

export type ActivityKind = 'task' | 'sales_run' | 'post' | 'meeting' | 'lead' | 'email';

export type ActivityEntry = {
  id: string;
  kind: ActivityKind;
  label: string;
  department: 'Sales' | 'Marketing' | 'Company' | 'Workspace';
  status: string;
  createdAt: string;
  /** Where the row links to. */
  path: string;
};

export type DashboardTask = { id: string; title: string; status: 'open' | 'in_progress' | 'completed'; due_at: string | null; created_at: string };
export type DashboardMeeting = { id: string; title: string; starts_at: string };

export type DashboardData = {
  rangeDays: DashboardRange;
  days: DashboardDay[];
  /** This period and the one before it, so a comparison is always like for like. */
  actions: { current: number; previous: number };
  departments: Record<'sales' | 'marketing' | 'company', { current: number; previous: number }>;
  leads: { total: number; inRange: number; daily: number[] };
  meetings: { total: number; upcoming: number; daily: number[] };
  published: { total: number; inRange: number; daily: number[] };
  recent: ActivityEntry[];
  tasks: DashboardTask[];
  upcomingMeetings: DashboardMeeting[];
  /** Sections whose query failed, so the screen can say so instead of showing zero. */
  unavailable: string[];
};

/** Local date key, so a run at 11pm lands on the day the person had it. */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

type Rows<T> = { data: T[] | null; error: { message: string } | null };

/** A failed section reports itself and yields no rows, rather than failing the page. */
async function settle<T>(name: string, query: PromiseLike<Rows<T>>, failures: string[]): Promise<T[]> {
  try {
    const { data, error } = await query;
    if (error) {
      failures.push(name);
      return [];
    }
    return data ?? [];
  } catch {
    failures.push(name);
    return [];
  }
}

async function count(name: string, query: PromiseLike<{ count: number | null; error: unknown }>, failures: string[]) {
  try {
    const { count: value, error } = await query;
    if (error) {
      failures.push(name);
      return 0;
    }
    return value ?? 0;
  } catch {
    failures.push(name);
    return 0;
  }
}

const MARKETING_TASKS = new Set<string>(MARKETING_TASK_TYPES);

const RUN_LABELS: Record<string, string> = {
  completed: 'Completed',
  failed: 'Failed',
  blocked: 'Needs attention',
  awaiting_approval: 'Waiting for you',
  ready: 'Ready for review',
  running: 'Running',
  planning: 'Running',
  discovering: 'Running',
  screening: 'Running',
  calling: 'Running',
};

export function statusLabel(status: string): string {
  return RUN_LABELS[status] ?? (status ? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ') : 'Queued');
}

export async function loadDashboard(rangeDays: DashboardRange): Promise<DashboardData> {
  const failures: string[] = [];
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - (rangeDays - 1));
  start.setHours(0, 0, 0, 0);
  const previousStart = new Date(start);
  previousStart.setDate(previousStart.getDate() - rangeDays);
  const since = previousStart.toISOString();
  const startIso = start.toISOString();
  const nowIso = now.toISOString();

  const [
    tasks,
    salesRuns,
    calls,
    videos,
    posts,
    messages,
    deals,
    campaigns,
    teamMessages,
    teamTasks,
    leadsWindow,
    meetingsWindow,
    leadTotal,
    meetingTotal,
    upcomingCount,
    publishedTotal,
    recentTasks,
    recentRuns,
    recentPosts,
    recentMeetings,
    recentLeads,
    recentCampaigns,
    myTasks,
    nextMeetings,
    auth,
  ] = await Promise.all([
    settle<{ created_at: string; task_type: string }>('activity', supabase.from('tasks').select('created_at, task_type').gte('created_at', since), failures),
    settle<{ created_at: string }>('activity', supabase.from('sales_runs').select('created_at').gte('created_at', since), failures),
    settle<{ created_at: string }>('activity', supabase.from('calls').select('created_at').gte('created_at', since), failures),
    settle<{ created_at: string }>('activity', supabase.from('videos').select('created_at').gte('created_at', since), failures),
    settle<{ created_at: string; status: string }>('activity', supabase.from('social_posts').select('created_at, status').gte('created_at', since), failures),
    settle<{ created_at: string; conversations: { kind: string } | null }>(
      'activity',
      supabase.from('messages').select('created_at, conversations ( kind )').eq('role', 'user').gte('created_at', since) as unknown as PromiseLike<
        Rows<{ created_at: string; conversations: { kind: string } | null }>
      >,
      failures,
    ),
    settle<{ created_at: string }>('activity', supabase.from('sales_deals').select('created_at').gte('created_at', since), failures),
    settle<{ created_at: string }>('activity', supabase.from('outreach_campaigns').select('created_at').gte('created_at', since), failures),
    settle<{ created_at: string }>('company', supabase.from('organization_chat_messages').select('created_at').gte('created_at', since), failures),
    settle<{ created_at: string }>('company', supabase.from('organization_tasks').select('created_at').gte('created_at', since), failures),
    settle<{ created_at: string }>('leads', supabase.from('leads').select('created_at').gte('created_at', startIso), failures),
    settle<{ created_at: string }>('meetings', supabase.from('sales_meetings').select('created_at').gte('created_at', startIso), failures),
    count('leads', supabase.from('leads').select('id', { count: 'exact', head: true }), failures),
    count('meetings', supabase.from('sales_meetings').select('id', { count: 'exact', head: true }), failures),
    count('meetings', supabase.from('sales_meetings').select('id', { count: 'exact', head: true }).gte('starts_at', nowIso), failures),
    count('published', supabase.from('social_posts').select('id', { count: 'exact', head: true }).eq('status', 'posted'), failures),
    settle<{ id: string; task_type: string; status: string; created_at: string }>(
      'recent',
      supabase.from('tasks').select('id, task_type, status, created_at').order('created_at', { ascending: false }).limit(6),
      failures,
    ),
    settle<{ id: string; request: string; status: string; created_at: string }>(
      'recent',
      supabase.from('sales_runs').select('id, request, status, created_at').order('created_at', { ascending: false }).limit(6),
      failures,
    ),
    settle<{ id: string; platform: SocialPlatform; status: string; created_at: string }>(
      'recent',
      supabase.from('social_posts').select('id, platform, status, created_at').order('created_at', { ascending: false }).limit(6),
      failures,
    ),
    settle<{ id: string; title: string; created_at: string }>(
      'recent',
      supabase.from('sales_meetings').select('id, title, created_at').order('created_at', { ascending: false }).limit(6),
      failures,
    ),
    settle<{ id: string; name: string | null; company: string | null; email: string | null; created_at: string }>(
      'recent',
      supabase.from('leads').select('id, name, company, email, created_at').order('created_at', { ascending: false }).limit(6),
      failures,
    ),
    settle<{ id: string; title: string; status: string; created_at: string }>(
      'recent',
      supabase.from('outreach_campaigns').select('id, title, status, created_at').order('created_at', { ascending: false }).limit(6),
      failures,
    ),
    settle<DashboardTask & { assigned_to: string }>(
      'tasks',
      supabase
        .from('organization_tasks')
        .select('id, title, status, due_at, created_at, assigned_to')
        .neq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(30),
      failures,
    ),
    settle<DashboardMeeting>(
      'meetings',
      supabase.from('sales_meetings').select('id, title, starts_at').gte('starts_at', nowIso).order('starts_at', { ascending: true }).limit(3),
      failures,
    ),
    supabase.auth.getUser(),
  ]);

  // One bucket per local day across both periods; the chart shows the current one.
  const buckets = new Map<string, DashboardDay>();
  const days: DashboardDay[] = [];
  for (let offset = rangeDays * 2 - 1; offset >= 0; offset--) {
    const date = new Date(now);
    date.setDate(date.getDate() - offset);
    const day = { key: dayKey(date), label: String(date.getDate()), sales: 0, marketing: 0, company: 0, total: 0 };
    buckets.set(day.key, day);
    if (offset < rangeDays) days.push(day);
  }
  const tally = (iso: string, department: 'sales' | 'marketing' | 'company' | null) => {
    const day = buckets.get(dayKey(new Date(iso)));
    if (!day) return;
    day.total += 1;
    if (department) day[department] += 1;
  };
  tasks.forEach((row) => tally(row.created_at, MARKETING_TASKS.has(row.task_type) ? 'marketing' : 'sales'));
  salesRuns.forEach((row) => tally(row.created_at, 'sales'));
  calls.forEach((row) => tally(row.created_at, 'sales'));
  deals.forEach((row) => tally(row.created_at, 'sales'));
  campaigns.forEach((row) => tally(row.created_at, 'sales'));
  videos.forEach((row) => tally(row.created_at, 'marketing'));
  posts.forEach((row) => tally(row.created_at, 'marketing'));
  teamMessages.forEach((row) => tally(row.created_at, 'company'));
  teamTasks.forEach((row) => tally(row.created_at, 'company'));
  messages.forEach((row) => {
    const kind = row.conversations?.kind;
    tally(row.created_at, kind === 'sales_ai' || kind === 'crm' ? 'sales' : kind === 'content' || kind === 'campaign' ? 'marketing' : null);
  });

  const all = [...buckets.values()];
  const previous = all.slice(0, rangeDays);
  const sum = (list: DashboardDay[], field: keyof Omit<DashboardDay, 'key' | 'label'>) => list.reduce((total, day) => total + day[field], 0);

  const series = (rows: { created_at: string }[]) => {
    const map = new Map(days.map((day) => [day.key, 0]));
    rows.forEach((row) => {
      const key = dayKey(new Date(row.created_at));
      if (map.has(key)) map.set(key, (map.get(key) ?? 0) + 1);
    });
    return days.map((day) => map.get(day.key) ?? 0);
  };
  const postedInRange = posts.filter((row) => row.status === 'posted' && row.created_at >= startIso);

  const recent: ActivityEntry[] = [
    ...recentTasks.map((row) => ({
      id: `task-${row.id}`,
      kind: 'task' as const,
      label: TASK_LABELS[row.task_type as AnyTaskType] ?? row.task_type.replace(/_/g, ' '),
      department: MARKETING_TASKS.has(row.task_type) ? ('Marketing' as const) : ('Sales' as const),
      status: statusLabel(row.status),
      createdAt: row.created_at,
      path: `/history/${row.id}`,
    })),
    ...recentRuns.map((row) => ({
      id: `run-${row.id}`,
      kind: 'sales_run' as const,
      label: row.request,
      department: 'Sales' as const,
      status: statusLabel(row.status),
      createdAt: row.created_at,
      path: '/sales',
    })),
    ...recentPosts.map((row) => ({
      id: `post-${row.id}`,
      kind: 'post' as const,
      label: row.status === 'posted' ? `Published to ${SOCIAL_LABELS[row.platform] ?? row.platform}` : `Post to ${SOCIAL_LABELS[row.platform] ?? row.platform}`,
      department: 'Marketing' as const,
      status: row.status === 'posted' ? 'Published' : statusLabel(row.status),
      createdAt: row.created_at,
      path: '/marketing',
    })),
    ...recentMeetings.map((row) => ({
      id: `meeting-${row.id}`,
      kind: 'meeting' as const,
      label: `Meeting scheduled: ${row.title}`,
      department: 'Sales' as const,
      status: 'Scheduled',
      createdAt: row.created_at,
      path: '/sales?view=meetings',
    })),
    ...recentLeads.map((row) => ({
      id: `lead-${row.id}`,
      kind: 'lead' as const,
      label: `New lead: ${row.name || row.company || row.email || 'Unnamed contact'}`,
      department: 'Sales' as const,
      status: 'Added',
      createdAt: row.created_at,
      path: '/history',
    })),
    ...recentCampaigns.map((row) => ({
      id: `email-${row.id}`,
      kind: 'email' as const,
      label: `Email duty: ${row.title}`,
      department: 'Sales' as const,
      status: row.status === 'active' ? 'In progress' : row.status === 'completed' ? 'Everyone replied' : statusLabel(row.status),
      createdAt: row.created_at,
      path: '/sales?view=email',
    })),
  ]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 6);

  const me = auth.data.user?.id;
  return {
    rangeDays,
    days,
    actions: { current: sum(days, 'total'), previous: sum(previous, 'total') },
    departments: {
      sales: { current: sum(days, 'sales'), previous: sum(previous, 'sales') },
      marketing: { current: sum(days, 'marketing'), previous: sum(previous, 'marketing') },
      company: { current: sum(days, 'company'), previous: sum(previous, 'company') },
    },
    leads: { total: leadTotal, inRange: leadsWindow.length, daily: series(leadsWindow) },
    meetings: { total: meetingTotal, upcoming: upcomingCount, daily: series(meetingsWindow) },
    published: { total: publishedTotal, inRange: postedInRange.length, daily: series(postedInRange) },
    recent,
    tasks: myTasks.filter((task) => task.assigned_to === me).slice(0, 5),
    upcomingMeetings: nextMeetings,
    unavailable: [...new Set(failures)],
  };
}

/**
 * "12% more than the 14 days before", or nothing when there is no earlier
 * activity to compare with — a percentage over zero is not a real number.
 */
export function compare(current: number, previous: number): { text: string; direction: 'up' | 'down' | 'flat' } | undefined {
  if (previous === 0) return undefined;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return { text: 'No change', direction: 'flat' };
  return { text: `${Math.abs(change)}%`, direction: change > 0 ? 'up' : 'down' };
}

export function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 0) {
    const ahead = -seconds;
    if (ahead < 3600) return `in ${Math.max(1, Math.round(ahead / 60))} min`;
    if (ahead < 86400) return `in ${Math.round(ahead / 3600)} hr`;
    const days = Math.round(ahead / 86400);
    return days === 1 ? 'tomorrow' : `in ${days} days`;
  }
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** "Today, 4:00 PM", "Tomorrow, 11:00 AM", or "Oct 24, 3:00 PM". */
export function meetingTime(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}
