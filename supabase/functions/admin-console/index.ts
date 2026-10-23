// Everything the CEO Control Center shows.
//
// This function is the authorization boundary for /ceo. The route being hidden
// in the app is a convenience for the person using it; *this* is what actually
// stops anyone else reading the platform. Every request, whatever it asks for,
// goes through the same two gates before a single row is read:
//
//   1. A valid session (the caller's own JWT, verified by Supabase).
//   2. A row in `app_admins` for that user id, looked up with the service-role
//      key so RLS cannot be tricked into answering differently.
//
// Only then does the service-role client read across users. A caller who is
// signed in but not an admin gets 403 and no data of any kind.
//
// What it deliberately does not return:
//
//   - No message text, task inputs or outputs, video prompts, call transcripts
//     or notes. The console reports *that* things happened, not what was said.
//     Owning the platform is not a reason to read everyone's drafts.
//     The one exception is `feedback_messages`: people write those *to* the
//     Synq team from Settings > Help, so their text is returned here.
//   - No secret values. Integration health reports whether a key is present,
//     never any part of the key itself.
//   - Lead phone numbers are masked to their last two digits.
//
// Aggregation happens in TypeScript over fetched rows, which is honest at this
// size (the whole database is a few hundred rows) and would need moving into
// SQL views long before it was millions.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

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

/** How far back the charts look. */
const USAGE_DAYS = 30;
/** A ceiling on every read, so one query can never pull the whole database. */
const ROW_CAP = 5000;
/** Don't write a "console viewed" event more often than this. */
const VIEW_LOG_INTERVAL_MS = 10 * 60 * 1000;

type Severity = 'info' | 'warning' | 'error';

type EventRow = {
  id: string;
  user_id: string | null;
  source: string;
  kind: string;
  severity: Severity;
  summary: string;
  subject_id: string | null;
  meta: Record<string, unknown>;
  created_at: string;
};

const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/** Counts per day for the last N days, oldest first, with empty days kept. */
function series(timestamps: string[], days = USAGE_DAYS) {
  const buckets = new Map<string, number>();
  const out: { key: string; count: number }[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    buckets.set(key, 0);
    out.push({ key, count: 0 });
  }
  for (const iso of timestamps) {
    const key = dayKey(iso);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  for (const day of out) day.count = buckets.get(day.key) ?? 0;
  return out;
}

const since = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
};

/** Last two digits only: enough to recognise a number you already know. */
function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length < 3) return '••';
  return `••••${digits.slice(-2)}`;
}

type Row = Record<string, unknown>;

async function fetchAll(db: SupabaseClient, table: string, columns: string): Promise<Row[]> {
  const { data, error } = await db.from(table).select(columns).limit(ROW_CAP);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as unknown as Row[];
}

// ---------------------------------------------------------------------------
// Integration health
// ---------------------------------------------------------------------------
//
// Two independent signals, because either alone lies: whether the key is
// configured (from the environment, as a boolean), and what actually happened
// last time Synq used it (from the rows). A configured key that fails every
// call is not "healthy", and a working key nobody has used is not "failing".

type Integration = {
  id: string;
  name: string;
  purpose: string;
  /** Names only. A value is never read, let alone returned. */
  secrets: { name: string; configured: boolean }[];
  configured: boolean;
  status: 'healthy' | 'failing' | 'idle' | 'not_configured';
  detail: string;
  lastUsedAt: string | null;
  failures24h: number;
};

function hasSecret(name: string): boolean {
  const value = Deno.env.get(name);
  return typeof value === 'string' && value.trim().length > 0;
}

function integrationFrom(
  id: string,
  name: string,
  purpose: string,
  secretNames: string[],
  activity: { lastOkAt: string | null; lastFailAt: string | null; failures24h: number; note: string }
): Integration {
  const secrets = secretNames.map((secret) => ({ name: secret, configured: hasSecret(secret) }));
  const configured = secrets.every((secret) => secret.configured);
  const lastUsedAt =
    [activity.lastOkAt, activity.lastFailAt].filter(Boolean).sort().reverse()[0] ?? null;

  let status: Integration['status'] = 'idle';
  let detail = activity.note;

  if (!configured) {
    const missing = secrets.filter((secret) => !secret.configured).map((secret) => secret.name);
    status = 'not_configured';
    detail = `Not configured — missing ${missing.join(', ')}`;
  } else if (!lastUsedAt) {
    status = 'idle';
    detail = detail || 'Configured, never used';
  } else if (activity.lastFailAt && (!activity.lastOkAt || activity.lastFailAt > activity.lastOkAt)) {
    status = 'failing';
    detail = detail || 'The most recent attempt failed';
  } else {
    status = 'healthy';
    detail = detail || 'The most recent attempt succeeded';
  }

  return { id, name, purpose, secrets, configured, status, detail, lastUsedAt, failures24h: activity.failures24h };
}

// ---------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------

async function snapshot(db: SupabaseClient) {
  const [
    { data: userList, error: userError },
    profiles,
    departments,
    tasks,
    messages,
    conversations,
    calls,
    leads,
    videos,
    runs,
    prospects,
    admins,
  ] = await Promise.all([
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    fetchAll(db, 'profiles', 'id, business_name, created_at'),
    fetchAll(db, 'departments', 'id, user_id, department_type, display_name'),
    fetchAll(db, 'tasks', 'id, user_id, task_type, status, created_at, completed_at'),
    fetchAll(db, 'messages', 'id, user_id, role, conversation_id, created_at'),
    fetchAll(db, 'conversations', 'id, user_id, kind, created_at'),
    fetchAll(db, 'calls', 'id, user_id, outcome, created_at'),
    fetchAll(db, 'leads', 'id, user_id, name, company, phone, status, source, created_at'),
    fetchAll(db, 'videos', 'id, user_id, status, error, resolution, duration_seconds, created_at, updated_at'),
    fetchAll(db, 'sales_runs', 'id, user_id, status, blocked_reason, calls_placed, created_at, updated_at'),
    fetchAll(db, 'prospects', 'id, user_id, name, outreach_status, temperature, call_error, called_at, source'),
    fetchAll(db, 'app_admins', 'user_id, role, note, granted_at'),
  ]);

  if (userError) throw new Error(`auth users: ${userError.message}`);
  const authUsers = userList?.users ?? [];

  const str = (row: Row, key: string) => (row[key] == null ? null : String(row[key]));

  const businessNames = new Map(profiles.map((row) => [str(row, 'id'), str(row, 'business_name')]));
  const countBy = (rows: Row[], userId: string) =>
    rows.filter((row) => str(row, 'user_id') === userId).length;

  // -- Users -----------------------------------------------------------------
  const users = authUsers
    .map((user) => {
      const id = user.id;
      const lastActivity = [
        ...tasks.filter((row) => str(row, 'user_id') === id).map((row) => str(row, 'created_at')),
        ...messages.filter((row) => str(row, 'user_id') === id).map((row) => str(row, 'created_at')),
        ...videos.filter((row) => str(row, 'user_id') === id).map((row) => str(row, 'created_at')),
      ]
        .filter(Boolean)
        .sort()
        .reverse()[0] ?? null;

      return {
        id,
        email: user.email ?? null,
        businessName: businessNames.get(id) ?? null,
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at ?? null,
        confirmed: Boolean(user.email_confirmed_at),
        provider: (user.app_metadata?.provider as string | undefined) ?? 'email',
        tasks: countBy(tasks, id),
        messages: countBy(messages, id),
        calls: countBy(calls, id),
        leads: countBy(leads, id),
        videos: countBy(videos, id),
        departments: countBy(departments, id),
        lastActivityAt: lastActivity,
        isAdmin: admins.some((row) => str(row, 'user_id') === id),
      };
    })
    .sort((a, b) => (b.lastSignInAt ?? '').localeCompare(a.lastSignInAt ?? ''));

  const activeUsers = (days: number) => {
    const cutoff = since(days);
    return users.filter(
      (user) =>
        (user.lastActivityAt && user.lastActivityAt > cutoff) ||
        (user.lastSignInAt && user.lastSignInAt > cutoff)
    ).length;
  };

  // -- Company overview ------------------------------------------------------
  const failedTasks = tasks.filter((row) => str(row, 'status') === 'failed').length;
  const completedTasks = tasks.filter((row) => str(row, 'status') === 'completed').length;
  const totalActions = tasks.length + messages.length + calls.length + videos.length;

  const overview = {
    users: users.length,
    activeUsers7d: activeUsers(7),
    activeUsers30d: activeUsers(30),
    newUsers30d: users.filter((user) => user.createdAt > since(30)).length,
    totalActions,
    actions7d: [
      ...tasks.map((row) => str(row, 'created_at')),
      ...messages.map((row) => str(row, 'created_at')),
      ...calls.map((row) => str(row, 'created_at')),
      ...videos.map((row) => str(row, 'created_at')),
    ].filter((iso) => iso && iso > since(7)).length,
    tasks: tasks.length,
    completedTasks,
    failedTasks,
    taskSuccessRate: tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : null,
    conversations: conversations.length,
    messages: messages.length,
    leads: leads.length,
    calls: calls.length,
    videos: videos.length,
    salesRuns: runs.length,
  };

  // -- Usage analytics -------------------------------------------------------
  const usage = {
    days: series([
      ...tasks.map((row) => String(row.created_at)),
      ...messages.map((row) => String(row.created_at)),
      ...calls.map((row) => String(row.created_at)),
      ...videos.map((row) => String(row.created_at)),
    ]),
    signups: series(users.map((user) => user.createdAt)),
    byDepartment: [
      { label: 'Sales AI', count: conversations.filter((row) => str(row, 'kind') === 'sales_ai').length },
      {
        label: 'Marketing AI',
        count: conversations.filter((row) => ['campaign', 'content'].includes(String(row.kind))).length,
      },
      { label: 'Workspace assistant', count: conversations.filter((row) => str(row, 'kind') === 'assistant').length },
      { label: 'CRM coach', count: conversations.filter((row) => str(row, 'kind') === 'crm').length },
    ].filter((entry) => entry.count > 0),
    taskTypes: Object.entries(
      tasks.reduce<Record<string, number>>((acc, row) => {
        const key = String(row.task_type);
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {})
    )
      .map(([label, count]) => ({ label: label.replace(/_/g, ' '), count }))
      .sort((a, b) => b.count - a.count),
  };

  // -- AI workforce ----------------------------------------------------------
  // One row per department type that actually exists in the departments table,
  // counted across every user.
  const departmentTypes = [...new Set(departments.map((row) => String(row.department_type)))].sort();
  const conversationKindFor: Record<string, string[]> = {
    sales: ['sales_ai'],
    marketing: ['campaign', 'content'],
    workspace: ['assistant'],
    sales_crm: ['crm'],
  };
  const marketingTaskTypes = ['plan_campaign', 'draft_content', 'repurpose_content', 'content_ideas'];

  const workforce = departmentTypes.map((type) => {
    const kinds = conversationKindFor[type] ?? [];
    const chats = conversations.filter((row) => kinds.includes(String(row.kind)));
    const chatIds = new Set(chats.map((row) => String(row.id)));
    const departmentTasks = tasks.filter((row) => {
      const isMarketing = marketingTaskTypes.includes(String(row.task_type));
      if (type === 'marketing') return isMarketing;
      if (type === 'sales') return !isMarketing;
      return false;
    });
    const failed = departmentTasks.filter((row) => str(row, 'status') === 'failed').length;

    return {
      type,
      name: String(departments.find((row) => str(row, 'department_type') === type)?.display_name ?? type),
      seats: departments.filter((row) => str(row, 'department_type') === type).length,
      conversations: chats.length,
      messages: messages.filter((row) => chatIds.has(String(row.conversation_id))).length,
      tasks: departmentTasks.length,
      failedTasks: failed,
      lastActiveAt:
        [...chats.map((row) => String(row.created_at)), ...departmentTasks.map((row) => String(row.created_at))]
          .sort()
          .reverse()[0] ?? null,
    };
  });

  // -- Errors and alerts -----------------------------------------------------
  const alerts = [
    ...videos
      .filter((row) => str(row, 'status') === 'failed')
      .map((row) => ({
        id: `video-${String(row.id)}`,
        source: 'Video generation',
        summary: str(row, 'error') ?? 'Generation failed with no reason given',
        userId: str(row, 'user_id'),
        at: str(row, 'updated_at') ?? str(row, 'created_at'),
        severity: 'error' as Severity,
      })),
    ...tasks
      .filter((row) => str(row, 'status') === 'failed')
      .map((row) => ({
        id: `task-${String(row.id)}`,
        source: 'Task',
        summary: `${String(row.task_type).replace(/_/g, ' ')} failed`,
        userId: str(row, 'user_id'),
        at: str(row, 'completed_at') ?? str(row, 'created_at'),
        severity: 'error' as Severity,
      })),
    ...runs
      .filter((row) => ['blocked', 'failed'].includes(String(row.status)))
      .map((row) => ({
        id: `run-${String(row.id)}`,
        source: 'Sales run',
        summary: str(row, 'blocked_reason') ?? `Run ${String(row.status)}`,
        userId: str(row, 'user_id'),
        at: str(row, 'updated_at'),
        severity: (String(row.status) === 'failed' ? 'error' : 'warning') as Severity,
      })),
    ...prospects
      .filter((row) => str(row, 'outreach_status') === 'failed')
      .map((row) => ({
        id: `prospect-${String(row.id)}`,
        source: 'Outbound call',
        summary: str(row, 'call_error') ?? 'Call failed',
        userId: str(row, 'user_id'),
        at: str(row, 'called_at'),
        severity: 'error' as Severity,
      })),
  ].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));

  // -- Integration health ----------------------------------------------------
  const latest = (rows: Row[], key: string) =>
    rows
      .map((row) => str(row, key))
      .filter((value): value is string => Boolean(value))
      .sort()
      .reverse()[0] ?? null;

  const readyVideos = videos.filter((row) => str(row, 'status') === 'ready');
  const failedVideos = videos.filter((row) => str(row, 'status') === 'failed');
  const calledProspects = prospects.filter((row) => str(row, 'outreach_status') === 'called');
  const failedProspects = prospects.filter((row) => str(row, 'outreach_status') === 'failed');
  const completedTaskRows = tasks.filter((row) => str(row, 'status') === 'completed');
  const failedTaskRows = tasks.filter((row) => str(row, 'status') === 'failed');
  const placesProspects = prospects.filter((row) => String(row.source ?? '').includes('places'));
  const within24h = (rows: Row[], key: string) =>
    rows.filter((row) => (str(row, key) ?? '') > since(1)).length;

  const integrations: Integration[] = [
    integrationFrom('gemini', 'Google Gemini', 'Every AI reply, task and classification', ['GEMINI_API_KEY'], {
      lastOkAt: latest(completedTaskRows, 'completed_at') ?? latest(messages, 'created_at'),
      lastFailAt: latest(failedTaskRows, 'completed_at'),
      failures24h: within24h(failedTaskRows, 'completed_at'),
      note: '',
    }),
    integrationFrom(
      'elevenlabs',
      'ElevenLabs + Twilio',
      'Outbound voice calls',
      ['ELEVENLABS_API_KEY', 'ELEVENLABS_AGENT_ID', 'ELEVENLABS_PHONE_NUMBER_ID'],
      {
        lastOkAt: latest(calledProspects, 'called_at'),
        lastFailAt: latest(failedProspects, 'called_at'),
        failures24h: within24h(failedProspects, 'called_at'),
        note: '',
      }
    ),
    integrationFrom('veo', 'Google Veo', 'Marketing video generation', ['GEMINI_API_KEY'], {
      lastOkAt: latest(readyVideos, 'updated_at'),
      lastFailAt: latest(failedVideos, 'updated_at'),
      failures24h: within24h(failedVideos, 'updated_at'),
      note: '',
    }),
    integrationFrom('places', 'Google Places', 'Finding businesses to call', ['GOOGLE_PLACES_API_KEY'], {
      lastOkAt: latest(placesProspects, 'created_at'),
      lastFailAt: null,
      failures24h: 0,
      note: placesProspects.length === 0 ? 'Configured, never used' : '',
    }),
  ];

  // -- Security --------------------------------------------------------------
  const security = {
    admins: admins
      .map((row) => ({
        userId: str(row, 'user_id'),
        email: authUsers.find((user) => user.id === str(row, 'user_id'))?.email ?? null,
        role: str(row, 'role'),
        note: str(row, 'note'),
        grantedAt: str(row, 'granted_at'),
      }))
      .sort((a, b) => (a.role ?? '').localeCompare(b.role ?? '')),
    recentSignIns: users
      .filter((user) => user.lastSignInAt)
      .slice(0, 12)
      .map((user) => ({ email: user.email, at: user.lastSignInAt, provider: user.provider })),
    unconfirmedAccounts: users.filter((user) => !user.confirmed).length,
    authProviders: [...new Set(users.map((user) => user.provider))],
  };

  // -- Sections with no data source yet --------------------------------------
  // Named rather than omitted, because "we do not measure this" is information
  // the person running the company needs, and an invented number is not.
  const unavailable = [
    {
      id: 'revenue',
      title: 'Revenue and billing',
      reason: 'No payment provider is connected and there is no subscription, invoice or plan table.',
      needed: 'A billing provider (e.g. Stripe) plus a subscriptions table written by its webhook.',
    },
    {
      id: 'organizations',
      title: 'Organizations',
      reason:
        'Synq has no organisation, team or workspace table. One account is one workspace, so the account count is also the workspace count.',
      needed: 'An organizations table plus membership rows, and user_id → org_id on every existing table.',
    },
    {
      id: 'automations',
      title: 'Automations',
      reason: 'Nothing in Synq runs on a schedule. There is no scheduler, no job queue and no automations table.',
      needed: 'A scheduled-jobs table plus a runner (pg_cron or a scheduled Edge Function).',
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    overview,
    users,
    usage,
    workforce,
    alerts: alerts.slice(0, 40),
    integrations,
    security,
    unavailable,
    leadSample: leads
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 10)
      .map((row) => ({
        id: str(row, 'id'),
        name: str(row, 'name'),
        company: str(row, 'company'),
        phone: maskPhone(str(row, 'phone')),
        status: str(row, 'status'),
        userId: str(row, 'user_id'),
        createdAt: str(row, 'created_at'),
      })),
    scale: { rowCap: ROW_CAP, capped: [tasks, messages, leads, videos].some((rows) => rows.length >= ROW_CAP) },
  };
}

/** The activity feed, newest first. Polled on its own so it stays cheap. */
async function feed(db: SupabaseClient, limit: number, severity: string | null) {
  let query = db
    .from('events')
    .select('id, user_id, source, kind, severity, summary, subject_id, meta, created_at')
    // Admins opening the console are kept as an audit trail (see
    // logConsoleView) but are noise in the feed, which is about what customers do.
    .neq('kind', 'admin.console_viewed')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));

  if (severity === 'trouble') query = query.neq('severity', 'info');

  const [{ data, error }, { data: userList }] = await Promise.all([
    query,
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (error) throw new Error(error.message);

  const emails = new Map((userList?.users ?? []).map((user) => [user.id, user.email ?? null]));
  const rows = (data ?? []) as EventRow[];

  return {
    events: rows.map((row) => ({
      id: row.id,
      source: row.source,
      kind: row.kind,
      severity: row.severity,
      summary: row.summary,
      subjectId: row.subject_id,
      userId: row.user_id,
      email: row.user_id ? (emails.get(row.user_id) ?? null) : null,
      backfilled: row.meta?.backfilled === true,
      createdAt: row.created_at,
    })),
  };
}

/** Global search. Matches what the console is allowed to show, nothing more. */
async function search(db: SupabaseClient, term: string) {
  const query = term.trim();
  if (query.length < 2) return { results: [] };
  const like = `%${query.replace(/[%_]/g, (match) => `\\${match}`)}%`;

  const [{ data: userList }, leads, events, runs] = await Promise.all([
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    db.from('leads').select('id, user_id, name, company, phone, status').or(`name.ilike.${like},company.ilike.${like}`).limit(10),
    db.from('events').select('id, user_id, kind, summary, severity, created_at').ilike('summary', like).order('created_at', { ascending: false }).limit(10),
    db.from('sales_runs').select('id, user_id, status, request').ilike('request', like).limit(5),
  ]);

  const lower = query.toLowerCase();
  const users = (userList?.users ?? [])
    .filter((user) => (user.email ?? '').toLowerCase().includes(lower))
    .slice(0, 10)
    .map((user) => ({ kind: 'user' as const, id: user.id, title: user.email ?? user.id, subtitle: `Joined ${String(user.created_at).slice(0, 10)}` }));

  return {
    results: [
      ...users,
      ...((leads.data ?? []) as Row[]).map((row) => ({
        kind: 'lead' as const,
        id: String(row.id),
        title: String(row.name ?? row.company ?? 'Lead'),
        subtitle: `${String(row.status)} · ${maskPhone(row.phone == null ? null : String(row.phone)) ?? 'no number'}`,
        userId: String(row.user_id),
      })),
      ...((runs.data ?? []) as Row[]).map((row) => ({
        kind: 'run' as const,
        id: String(row.id),
        title: 'Sales run',
        subtitle: String(row.status),
        userId: String(row.user_id),
      })),
      ...((events.data ?? []) as Row[]).map((row) => ({
        kind: 'event' as const,
        id: String(row.id),
        title: String(row.summary),
        subtitle: `${String(row.kind)} · ${String(row.created_at).slice(0, 10)}`,
        userId: row.user_id == null ? null : String(row.user_id),
      })),
    ],
  };
}

/** One user, drilled into. Same rules: activity, never content. */
async function userDetail(db: SupabaseClient, userId: string) {
  const { data: user, error } = await db.auth.admin.getUserById(userId);
  if (error || !user?.user) return { error: 'No such user.' };

  const [tasks, events, leads, videos, conversations, profile] = await Promise.all([
    db.from('tasks').select('id, task_type, status, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
    db.from('events').select('id, kind, severity, summary, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(25),
    db.from('leads').select('id, name, company, phone, status, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(15),
    db.from('videos').select('id, status, error, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
    db.from('conversations').select('id, kind, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(15),
    db.from('profiles').select('business_name, created_at').eq('id', userId).maybeSingle(),
  ]);

  return {
    user: {
      id: user.user.id,
      email: user.user.email ?? null,
      businessName: (profile.data as Row | null)?.business_name ?? null,
      createdAt: user.user.created_at,
      lastSignInAt: user.user.last_sign_in_at ?? null,
      confirmed: Boolean(user.user.email_confirmed_at),
      provider: (user.user.app_metadata?.provider as string | undefined) ?? 'email',
    },
    tasks: tasks.data ?? [],
    events: events.data ?? [],
    videos: videos.data ?? [],
    conversations: conversations.data ?? [],
    leads: ((leads.data ?? []) as Row[]).map((row) => ({
      ...row,
      phone: maskPhone(row.phone == null ? null : String(row.phone)),
    })),
  };
}

/**
 * Feedback people sent from Settings > Help, newest first, for the admin
 * notification bell. These were written to the Synq team, so the text is
 * included (see the note at the top of this file).
 */
async function feedbackMessages(db: SupabaseClient) {
  const [{ data, error }, { data: userList }] = await Promise.all([
    db
      .from('feedback_messages')
      .select('id, user_id, body, created_at, acknowledged_at')
      .order('created_at', { ascending: false })
      .limit(30),
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (error) throw new Error(error.message);
  const emails = new Map((userList?.users ?? []).map((user) => [user.id, user.email ?? null]));
  return {
    feedback: (data ?? []).map((row) => ({
      id: String(row.id),
      email: emails.get(String(row.user_id)) ?? null,
      body: String(row.body),
      createdAt: String(row.created_at),
      acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : null,
    })),
  };
}

/** "Looking into it": the sender sees this next to their message. */
async function acknowledgeFeedback(db: SupabaseClient, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Unknown feedback message.');
  const { data, error } = await db
    .from('feedback_messages')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('id', id)
    .is('acknowledged_at', null)
    .select('acknowledged_at')
    .maybeSingle();
  if (error) throw new Error(error.message);
  // Already acknowledged (maybe by another admin) is not an error.
  return { acknowledgedAt: data?.acknowledged_at ? String(data.acknowledged_at) : null };
}

/**
 * Looking at the whole platform is itself an event worth recording, but not
 * once per poll — the feed refreshes every few seconds.
 */
async function logConsoleView(db: SupabaseClient, userId: string, email: string | null) {
  const { data } = await db
    .from('events')
    .select('created_at')
    .eq('kind', 'admin.console_viewed')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  const last = data?.[0]?.created_at as string | undefined;
  if (last && Date.now() - new Date(last).getTime() < VIEW_LOG_INTERVAL_MS) return;

  await db.from('events').insert({
    user_id: userId,
    source: 'admin',
    kind: 'admin.console_viewed',
    severity: 'info',
    summary: `CEO Control Center opened by ${email ?? userId}`,
    meta: {},
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  // Gate 1: a real session.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Not signed in.' }, 401);

  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await asCaller.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ error: 'Not signed in.' }, 401);

  // Gate 2: an admin row, read with the service key so no client-side policy,
  // header or role claim can influence the answer.
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: adminRow, error: adminError } = await db
    .from('app_admins')
    .select('user_id, role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (adminError) return json({ error: 'Could not verify access.' }, 500);
  if (!adminRow) {
    // Deliberately the same shape for "not an admin" whatever is asked for,
    // and nothing about what exists behind it.
    return json({ error: 'This account is not authorized for the CEO Control Center.' }, 403);
  }

  let body: { action?: string; query?: string; limit?: number; severity?: string; user_id?: string; feedback_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request body.' }, 400);
  }

  try {
    switch (body.action) {
      case 'snapshot': {
        await logConsoleView(db, user.id, user.email ?? null);
        const data = await snapshot(db);
        return json({ ...data, viewer: { email: user.email ?? null, role: adminRow.role } });
      }
      case 'feed':
        return json(await feed(db, body.limit ?? 40, body.severity ?? null));
      case 'feedback':
        return json(await feedbackMessages(db));
      case 'acknowledge':
        return json(await acknowledgeFeedback(db, String(body.feedback_id ?? '')));
      case 'search':
        return json(await search(db, String(body.query ?? '')));
      case 'user':
        return json(await userDetail(db, String(body.user_id ?? '')));
      default:
        return json({ error: 'Unknown action.' }, 400);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Something went wrong.' }, 500);
  }
});
