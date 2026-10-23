import { supabase } from '@/lib/supabase';

// The signed-in person's own history: what they did in Synq, newest first.
//
// It merges the platform timeline (`events`, written by triggers when a chat,
// video, AI task, lead or run is created) with the work the timeline does not
// cover: email duties, meetings they organized, images they generated and
// posts they published. Every query is filtered to this person's id. That
// matters for admins too: RLS lets an admin read everyone's events, and this
// page is about the person, not the platform.

export type HistoryKind = 'chat' | 'video' | 'task' | 'lead' | 'run' | 'email' | 'meeting' | 'image' | 'post' | 'account' | 'other';

export type HistoryEntry = {
  id: string;
  kind: HistoryKind;
  title: string;
  detail: string | null;
  status: 'done' | 'failed' | 'pending' | null;
  createdAt: string;
  /** Where the entry leads, when there is a page for it. */
  path: string | null;
};

type EventRow = { id: string; source: string; kind: string; severity: string; summary: string; subject_id: string | null; created_at: string };

const KIND_FOR_SOURCE: Record<string, HistoryKind> = {
  conversations: 'chat',
  videos: 'video',
  tasks: 'task',
  leads: 'lead',
  sales_runs: 'run',
  prospects: 'run',
  calls: 'run',
  auth: 'account',
  profiles: 'account',
  outreach: 'email',
};

const PATH_FOR_KIND: Partial<Record<HistoryKind, string>> = {
  chat: '/?ai=1',
  video: '/marketing',
  email: '/sales?view=email',
  meeting: '/sales?view=meetings',
  image: '/marketing',
  post: '/marketing',
  run: '/sales',
};

/** Events that are bookkeeping rather than something the person did. */
const HIDDEN_EVENT_KINDS = ['admin.console_viewed'];

function fromEvent(row: EventRow): HistoryEntry {
  const kind = KIND_FOR_SOURCE[row.source] ?? 'other';
  return {
    id: `event-${row.id}`,
    kind,
    // The stored summary is written for the admin console; say it from the person's side.
    title: row.kind === 'settings.failure_alert_requested' ? 'You reported a problem to the Synq team' : row.summary,
    detail: null,
    status: row.severity === 'error' ? 'failed' : row.kind.endsWith('.requested') ? 'pending' : null,
    createdAt: row.created_at,
    // Old-style AI tasks have their own result page.
    path: kind === 'task' && row.subject_id ? `/history/${row.subject_id}` : PATH_FOR_KIND[kind] ?? null,
  };
}

/** Up to `limit` entries. A part that fails to load is skipped, not fatal, unless every part fails. */
export async function loadMyHistory(userId: string, limit = 100): Promise<HistoryEntry[]> {
  const [events, emails, meetings, images, posts] = await Promise.all([
    supabase
      .from('events')
      .select('id, source, kind, severity, summary, subject_id, created_at')
      .eq('user_id', userId)
      .not('kind', 'in', `(${HIDDEN_EVENT_KINDS.join(',')})`)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase.from('outreach_campaigns').select('id, title, status, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit),
    supabase.from('sales_meetings').select('id, title, starts_at, created_at').eq('organizer_id', userId).order('created_at', { ascending: false }).limit(limit),
    supabase.from('generated_images').select('id, department, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit),
    supabase.from('social_posts').select('id, platform, status, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit),
  ]);

  const parts = [events, emails, meetings, images, posts];
  if (parts.every((part) => part.error)) throw new Error('Could not load your history. Check your connection and try again.');

  const entries: HistoryEntry[] = [
    ...((events.data ?? []) as EventRow[]).map(fromEvent),
    ...(emails.data ?? []).map((row) => ({
      id: `email-${row.id}`,
      kind: 'email' as const,
      title: `Email duty: ${row.title}`,
      detail: `Status: ${String(row.status).replace('_', ' ')}`,
      status: row.status === 'failed' ? ('failed' as const) : row.status === 'completed' ? ('done' as const) : null,
      createdAt: row.created_at,
      path: PATH_FOR_KIND.email ?? null,
    })),
    ...(meetings.data ?? []).map((row) => ({
      id: `meeting-${row.id}`,
      kind: 'meeting' as const,
      title: `Meeting planned: ${row.title}`,
      detail: `For ${new Date(row.starts_at).toLocaleString()}`,
      status: null,
      createdAt: row.created_at,
      path: PATH_FOR_KIND.meeting ?? null,
    })),
    ...(images.data ?? []).map((row) => ({
      id: `image-${row.id}`,
      kind: 'image' as const,
      title: 'Image created',
      detail: row.department ? `In ${String(row.department)}` : null,
      status: 'done' as const,
      createdAt: row.created_at,
      path: PATH_FOR_KIND.image ?? null,
    })),
    ...(posts.data ?? []).map((row) => ({
      id: `post-${row.id}`,
      kind: 'post' as const,
      title: `Post to ${String(row.platform)}`,
      detail: `Status: ${String(row.status)}`,
      status: row.status === 'posted' ? ('done' as const) : row.status === 'failed' ? ('failed' as const) : ('pending' as const),
      createdAt: row.created_at,
      path: PATH_FOR_KIND.post ?? null,
    })),
  ];

  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
