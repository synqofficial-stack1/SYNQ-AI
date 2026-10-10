import { supabase } from '@/lib/supabase';

// The client half of the CEO Control Center.
//
// Nothing here is a security boundary. `isAdmin()` decides whether to *show*
// the console, and the `admin-console` Edge Function decides whether to answer
// it — a non-admin who guesses the URL gets a 403 from the server, not a blank
// page from the client. Keep it that way: never move a check from there to here.

export type Severity = 'info' | 'warning' | 'error';

export type AdminEvent = {
  id: string;
  source: string;
  kind: string;
  severity: Severity;
  summary: string;
  subjectId: string | null;
  userId: string | null;
  email: string | null;
  /** True for the history reconstructed from row timestamps when events shipped. */
  backfilled: boolean;
  createdAt: string;
};

export type AdminUser = {
  id: string;
  email: string | null;
  businessName: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  confirmed: boolean;
  provider: string;
  tasks: number;
  messages: number;
  calls: number;
  leads: number;
  videos: number;
  departments: number;
  lastActivityAt: string | null;
  isAdmin: boolean;
};

export type AdminAlert = {
  id: string;
  source: string;
  summary: string;
  userId: string | null;
  at: string | null;
  severity: Severity;
};

export type Integration = {
  id: string;
  name: string;
  purpose: string;
  secrets: { name: string; configured: boolean }[];
  configured: boolean;
  status: 'healthy' | 'failing' | 'idle' | 'not_configured';
  detail: string;
  lastUsedAt: string | null;
  failures24h: number;
};

export type DepartmentHealth = {
  type: string;
  name: string;
  seats: number;
  conversations: number;
  messages: number;
  tasks: number;
  failedTasks: number;
  lastActiveAt: string | null;
};

export type Unavailable = {
  id: string;
  title: string;
  reason: string;
  needed: string;
};

export type Snapshot = {
  generatedAt: string;
  viewer: { email: string | null; role: string };
  overview: {
    users: number;
    activeUsers7d: number;
    activeUsers30d: number;
    newUsers30d: number;
    totalActions: number;
    actions7d: number;
    tasks: number;
    completedTasks: number;
    failedTasks: number;
    taskSuccessRate: number | null;
    conversations: number;
    messages: number;
    leads: number;
    calls: number;
    videos: number;
    salesRuns: number;
  };
  users: AdminUser[];
  usage: {
    days: { key: string; count: number }[];
    signups: { key: string; count: number }[];
    byDepartment: { label: string; count: number }[];
    taskTypes: { label: string; count: number }[];
  };
  workforce: DepartmentHealth[];
  alerts: AdminAlert[];
  integrations: Integration[];
  security: {
    admins: { userId: string | null; email: string | null; role: string | null; note: string | null; grantedAt: string | null }[];
    recentSignIns: { email: string | null; at: string | null; provider: string }[];
    unconfirmedAccounts: number;
    authProviders: string[];
  };
  unavailable: Unavailable[];
  leadSample: {
    id: string | null;
    name: string | null;
    company: string | null;
    phone: string | null;
    status: string | null;
    userId: string | null;
    createdAt: string | null;
  }[];
  scale: { rowCap: number; capped: boolean };
};

export type SearchHit = {
  kind: 'user' | 'lead' | 'run' | 'event';
  id: string;
  title: string;
  subtitle: string;
  userId?: string | null;
};

export type UserDetail = {
  user: {
    id: string;
    email: string | null;
    businessName: string | null;
    createdAt: string;
    lastSignInAt: string | null;
    confirmed: boolean;
    provider: string;
  };
  tasks: { id: string; task_type: string; status: string; created_at: string }[];
  events: { id: string; kind: string; severity: Severity; summary: string; created_at: string }[];
  videos: { id: string; status: string; error: string | null; created_at: string }[];
  conversations: { id: string; kind: string; created_at: string }[];
  leads: { id: string; name: string | null; company: string | null; phone: string | null; status: string; created_at: string }[];
};

/** Thrown with the server's own words, so the screen can show them unchanged. */
export class AdminError extends Error {
  constructor(
    message: string,
    readonly forbidden: boolean
  ) {
    super(message);
    this.name = 'AdminError';
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-console', { body });

  if (error) {
    // functions.invoke hides the body of a non-2xx response inside the error,
    // and the difference between "not allowed" and "broken" is the whole point
    // of this screen, so dig the status back out.
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 403) {
      throw new AdminError('This account is not authorized for the CEO Control Center.', true);
    }
    if (status === 401) {
      throw new AdminError('Your session has expired. Sign in again.', false);
    }
    throw new AdminError(error.message ?? 'Could not reach the control centre.', false);
  }

  const payload = data as T & { error?: string };
  if (payload && typeof payload === 'object' && 'error' in payload && payload.error) {
    throw new AdminError(String(payload.error), false);
  }
  return payload;
}

/**
 * Whether to offer the console at all. Reads `app_admins`, which RLS only lets
 * an admin see — so a normal account gets an empty list rather than a refusal,
 * and no error is worth showing them.
 */
export async function isAdmin(): Promise<boolean> {
  const { data, error } = await supabase.from('app_admins').select('user_id').limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

export const loadSnapshot = () => call<Snapshot>({ action: 'snapshot' });

export const loadFeed = (limit = 40, severity?: 'trouble') =>
  call<{ events: AdminEvent[] }>({ action: 'feed', limit, severity });

export const searchPlatform = (query: string) =>
  call<{ results: SearchHit[] }>({ action: 'search', query });

export const loadUserDetail = (userId: string) => call<UserDetail>({ action: 'user', user_id: userId });

/** "3 min ago". Shared shape with the dashboard's, kept local to avoid a cycle. */
export function ago(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? 'yesterday' : `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'last month' : `${months} months ago`;
}

/** Day labels for the charts, which take {key,label,count}. */
export function toChartDays(days: { key: string; count: number }[]) {
  return days.map((day) => ({ key: day.key, label: String(Number(day.key.slice(-2))), count: day.count }));
}
