import { supabase } from '@/lib/supabase';
import type { CallOutcome, Lead } from '@/types/database';

export type CallQueue = {
  /** Contacts with a phone number that haven't been called yet, in import order. */
  queue: Lead[];
  total: number;
  completed: number;
  counts: Record<CallOutcome, number>;
};

const EMPTY_COUNTS: Record<CallOutcome, number> = {
  interested: 0,
  call_back: 0,
  no_answer: 0,
  not_interested: 0,
  wrong_number: 0,
  qualified: 0,
};

/**
 * There is no "calling session" row anywhere. Progress is derived: a contact is
 * done once it has a call logged against it. Pausing is therefore just leaving
 * the screen, and resuming picks up wherever the data says you stopped — even on
 * a different device.
 */
export async function loadCallQueue(): Promise<CallQueue> {
  const [leadsResult, callsResult] = await Promise.all([
    supabase
      .from('leads')
      .select('*')
      .not('phone', 'is', null)
      .order('created_at', { ascending: true }),
    supabase
      .from('calls')
      .select('lead_id, outcome, created_at')
      .order('created_at', { ascending: false }),
  ]);

  if (leadsResult.error) throw new Error(leadsResult.error.message);
  if (callsResult.error) throw new Error(callsResult.error.message);

  const leads = (leadsResult.data ?? []) as Lead[];
  const calls = callsResult.data ?? [];

  // Newest first, so the first row seen for a lead is its current outcome.
  const latestOutcome = new Map<string, CallOutcome>();
  for (const call of calls) {
    if (!latestOutcome.has(call.lead_id)) {
      latestOutcome.set(call.lead_id, call.outcome as CallOutcome);
    }
  }

  const counts = { ...EMPTY_COUNTS };
  for (const outcome of latestOutcome.values()) counts[outcome] += 1;

  return {
    queue: leads.filter((lead) => !latestOutcome.has(lead.id)),
    total: leads.length,
    completed: latestOutcome.size,
    counts,
  };
}

export async function recordCall(input: {
  leadId: string;
  outcome: CallOutcome;
  notes?: string;
  followUpOn?: string | null;
}): Promise<void> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) throw new Error('You are signed out. Log in and try again.');

  const notes = input.notes?.trim();
  const { error } = await supabase.from('calls').insert({
    user_id: user.id,
    lead_id: input.leadId,
    outcome: input.outcome,
    notes: notes || null,
    follow_up_on: input.followUpOn || null,
  });

  if (error) throw new Error(error.message);
}

export type FollowUp = {
  id: string;
  outcome: CallOutcome;
  notes: string | null;
  followUpOn: string;
  leadName: string;
  company: string | null;
  phone: string | null;
};

/** Scheduled callbacks, soonest first. */
export async function listFollowUps(): Promise<FollowUp[]> {
  const { data, error } = await supabase
    .from('calls')
    .select('id, outcome, notes, follow_up_on, leads ( name, company, phone )')
    .not('follow_up_on', 'is', null)
    .order('follow_up_on', { ascending: true });

  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    outcome: CallOutcome;
    notes: string | null;
    follow_up_on: string;
    leads: { name: string | null; company: string | null; phone: string | null } | null;
  };

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    outcome: row.outcome,
    notes: row.notes,
    followUpOn: row.follow_up_on,
    leadName: row.leads?.name ?? 'Unnamed contact',
    company: row.leads?.company ?? null,
    phone: row.leads?.phone ?? null,
  }));
}
