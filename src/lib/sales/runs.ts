import { supabase } from '@/lib/supabase';
import type { Prospect, SalesRun, Temperature } from '@/types/database';

// A run is one instruction: "find 20 salons in Hyderabad and call them about
// our website service." It moves through five states and stops dead at the
// fourth until a person says go.
//
//   planning -> discovering -> screening -> awaiting_approval -> calling -> completed
//
// The pause before `calling` is the whole safety design. Everything up to it is
// reversible — a list on a screen. Everything after it rings a real phone in a
// real shop, and cannot be taken back.
//
// Calling a single number is a run of one, created by the call-number function
// with the user's confirmation as its approval.

export type RunWithProspects = { run: SalesRun; prospects: Prospect[] };

/** Unwraps the real message from a non-2xx edge function response. */
async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });

  if (error) {
    const response = (error as { context?: Response }).context;
    if (response && typeof response.json === 'function') {
      try {
        const parsed = await response.json();
        if (parsed?.error) throw new Error(parsed.error);
      } catch (e) {
        if (e instanceof Error && e.message) throw e;
      }
    }
    throw new Error(error.message || 'That did not go through. Try again.');
  }

  return data as T;
}

export async function createRun(input: {
  request: string;
  objective?: string | null;
  pitch?: string | null;
  industry?: string | null;
  location?: string | null;
  targetCount?: number;
}): Promise<SalesRun> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) throw new Error('You are signed out. Log in and try again.');

  const { data, error } = await supabase
    .from('sales_runs')
    .insert({
      user_id: user.id,
      request: input.request,
      objective: input.objective ?? null,
      pitch: input.pitch ?? null,
      industry: input.industry ?? null,
      location: input.location ?? null,
      target_count: Math.min(Math.max(input.targetCount ?? 20, 1), 50),
      status: 'planning',
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data as SalesRun;
}

export type DiscoveryOutcome = {
  found: number;
  eligible: number;
  excluded: number;
  query: string;
};

/** Searches Google Maps and fills the run with real businesses. */
export function discoverForRun(
  runId: string,
  params: { industry?: string | null; location?: string | null; limit?: number } = {}
): Promise<DiscoveryOutcome> {
  return invoke<DiscoveryOutcome>('discover-prospects', {
    run_id: runId,
    industry: params.industry ?? undefined,
    location: params.location ?? undefined,
    limit: params.limit,
  });
}

/**
 * The user has read the list and the terms, and is taking responsibility for
 * the calls. Nothing else in the app writes this column.
 */
export async function approveRun(runId: string): Promise<void> {
  const { error } = await supabase
    .from('sales_runs')
    .update({ attested_at: new Date().toISOString() })
    .eq('id', runId);
  if (error) throw new Error(error.message);
}

export type CallingOutcome = { queued: number; skipped: number; batch_id: string | null };

export function startCalling(runId: string): Promise<CallingOutcome> {
  return invoke<CallingOutcome>('place-calls', {
    run_id: runId,
    // The server enforces the 9am–9pm window; it needs to know where "local" is.
    tz_offset_minutes: -new Date().getTimezoneOffset(),
  });
}

/** Where a single call is, as reported by ElevenLabs. */
export type CallState = 'ringing' | 'talking' | 'wrapping_up' | 'done' | 'failed';

export type CallStatus = {
  state: CallState;
  note: string | null;
  temperature: Temperature | null;
  summary: string | null;
  error: string | null;
  transcript: { speaker: 'agent' | 'business'; text: string }[];
};

/**
 * Has the sales agent call one number now. `confirmed` is the user ticking
 * that they have permission; the server refuses without it and re-checks every
 * other gate itself.
 */
export function callNumber(input: {
  phone: string;
  pitch: string;
  confirmed: boolean;
}): Promise<{ prospect_id: string; run_id: string }> {
  return invoke('call-number', {
    action: 'start',
    phone: input.phone,
    pitch: input.pitch,
    confirmed: input.confirmed,
    tz_offset_minutes: -new Date().getTimezoneOffset(),
  });
}

/**
 * How a call started with `callNumber` is going. ElevenLabs does not tell Synq
 * when a call ends, so the screen asks, and the answer that finds it finished
 * also writes the result onto the call sheet.
 */
export async function checkCall(prospectId: string): Promise<CallStatus> {
  const status = await invoke<Partial<CallStatus>>('call-number', {
    action: 'status',
    prospect_id: prospectId,
  });
  return {
    state: status.state ?? 'ringing',
    note: status.note ?? null,
    temperature: status.temperature ?? null,
    summary: status.summary ?? null,
    error: status.error ?? null,
    transcript: status.transcript ?? [],
  };
}

/** Every call that has been attempted, newest first, across all runs. */
export async function loadRecentCalls(limit = 20): Promise<Prospect[]> {
  const { data, error } = await supabase
    .from('prospects')
    .select('*')
    .neq('outreach_status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as Prospect[];
}

/** The pitch used last time, so the user is not retyping it for every call. */
export async function loadLastPitch(): Promise<string | null> {
  const { data, error } = await supabase
    .from('sales_runs')
    .select('pitch')
    .not('pitch', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.pitch ?? null;
}

export async function listRuns(limit = 20): Promise<SalesRun[]> {
  const { data, error } = await supabase
    .from('sales_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as SalesRun[];
}

export async function loadRun(runId: string): Promise<RunWithProspects> {
  const [runResult, prospectsResult] = await Promise.all([
    supabase.from('sales_runs').select('*').eq('id', runId).maybeSingle(),
    supabase
      .from('prospects')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: true }),
  ]);

  if (runResult.error) throw new Error(runResult.error.message);
  if (!runResult.data) throw new Error('That run no longer exists.');
  if (prospectsResult.error) throw new Error(prospectsResult.error.message);

  return {
    run: runResult.data as SalesRun,
    prospects: (prospectsResult.data ?? []) as Prospect[],
  };
}

/** The most recent run, which is what the department opens on. */
export async function loadLatestRun(): Promise<RunWithProspects | null> {
  const { data, error } = await supabase
    .from('sales_runs')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return loadRun(data.id);
}

export type SalesDashboard = {
  runs: number;
  businessesFound: number;
  callsCompleted: number;
  byTemperature: Record<Temperature, number>;
  /** Called, but nobody picked up. Deliberately not counted as cold. */
  noAnswer: number;
};

const EMPTY_TEMPERATURES: Record<Temperature, number> = { hot: 0, warm: 0, cold: 0 };

/**
 * Derived from prospect rows rather than kept in a counter, so it cannot drift
 * out of step with what actually happened.
 */
export async function loadSalesDashboard(): Promise<SalesDashboard> {
  const [runsResult, prospectsResult] = await Promise.all([
    supabase.from('sales_runs').select('id', { count: 'exact', head: true }),
    supabase.from('prospects').select('outreach_status, temperature'),
  ]);

  if (prospectsResult.error) throw new Error(prospectsResult.error.message);
  const rows = (prospectsResult.data ?? []) as Pick<
    Prospect,
    'outreach_status' | 'temperature'
  >[];

  const byTemperature = { ...EMPTY_TEMPERATURES };
  let callsCompleted = 0;
  let noAnswer = 0;

  for (const row of rows) {
    if (row.outreach_status !== 'called') continue;
    callsCompleted++;
    if (row.temperature) byTemperature[row.temperature]++;
    else noAnswer++;
  }

  // A called row with no temperature did not connect. Keeping that apart from
  // "cold" matters: one is a rejection, the other is a missed ring, and folding
  // them together would overstate how badly the run went.
  return {
    runs: runsResult.count ?? 0,
    businessesFound: rows.length,
    callsCompleted,
    byTemperature,
    noAnswer,
  };
}

/** The spreadsheet view: one row per business, with whatever is known so far. */
export type SheetRow = {
  id: string;
  name: string;
  phone: string | null;
  category: string | null;
  address: string | null;
  website: string | null;
  status: Prospect['outreach_status'];
  eligibility: Prospect['eligibility'];
  eligibilityReason: string | null;
  note: string | null;
  /** Why a call could not be placed, when it could not. */
  callError: string | null;
  temperature: Temperature | null;
  calledAt: string | null;
};

export function toSheetRows(prospects: Prospect[]): SheetRow[] {
  return prospects.map((p) => ({
    id: p.id,
    name: p.name,
    phone: p.phone,
    category: p.category,
    address: p.address,
    website: p.website,
    status: p.outreach_status,
    eligibility: p.eligibility,
    eligibilityReason: p.eligibility_reason,
    note: p.call_notes,
    callError: p.call_error,
    temperature: p.temperature,
    calledAt: p.called_at,
  }));
}

/** CSV of the run, for the user who wants it in Excel or Sheets. */
export function runToCsv(rows: SheetRow[]): string {
  const escape = (value: string | null) => {
    const text = value ?? '';
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const header = ['Business', 'Phone', 'Category', 'Address', 'Status', 'Temperature', 'Note'];
  const lines = rows.map((row) =>
    [
      escape(row.name),
      escape(row.phone),
      escape(row.category),
      escape(row.address),
      escape(row.status),
      escape(row.temperature),
      escape(row.note),
    ].join(',')
  );

  return [header.join(','), ...lines].join('\n');
}
