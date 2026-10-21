import { supabase } from '@/lib/supabase';
import type { OutreachCampaign, OutreachRecipient } from '@/lib/outreach';

export function opportunityFromEmail(
  recipient: OutreachRecipient,
  campaign: OutreachCampaign,
): DealInput {
  if (recipient.analysis?.opted_out)
    throw new Error('This contact asked not to receive further outreach.');
  return {
    ...blankDeal(),
    title: `${campaign.title} · ${recipient.name || recipient.email}`.slice(
      0,
      160,
    ),
    contact_name: recipient.name,
    contact_email: recipient.email,
    stage:
      recipient.analysis?.intent === 'interested' ? 'interested' : 'contacted',
    next_action: (
      recipient.analysis?.next_step ||
      'Review the email conversation and agree the next step.'
    ).slice(0, 500),
    notes:
      `From email duty: ${campaign.title}\nSubject: ${campaign.subject}\n\n${recipient.analysis?.summary || 'Review the original conversation in Email duties.'}`.slice(
        0,
        5000,
      ),
  };
}

export const STAGES = [
  'new',
  'contacted',
  'interested',
  'negotiating',
  'won',
  'lost',
] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  new: 'New',
  contacted: 'Contacted',
  interested: 'Interested',
  negotiating: 'Negotiating',
  won: 'Won',
  lost: 'Lost',
};
export type Deal = {
  id: string;
  user_id: string;
  organization_id: string;
  title: string;
  contact_name: string;
  contact_email: string;
  company: string;
  stage: Stage;
  amount: number | null;
  expected_close: string | null;
  next_action: string;
  next_action_on: string | null;
  meeting_on: string | null;
  meeting_time: string;
  meeting_status: 'planned' | 'held' | 'no_show' | 'cancelled';
  meeting_notes: string;
  lost_reason: string;
  notes: string;
  quote_text: string;
  archived: boolean;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};
export type DealInput = Omit<
  Deal,
  | 'id'
  | 'user_id'
  | 'organization_id'
  | 'closed_at'
  | 'created_at'
  | 'updated_at'
>;
export type SalesTarget = {
  organization_id: string;
  month: string;
  revenue_goal: number;
  deals_goal: number;
  updated_at: string;
};
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00`);
  return !Number.isNaN(d.getTime()) && localDate(d) === value;
}
export function validateDeal(row: DealInput) {
  if (!row.title.trim() || row.title.length > 160)
    throw new Error('Enter a deal name (up to 160 characters).');
  if (!STAGES.includes(row.stage)) throw new Error('Choose a valid stage.');
  if (
    row.amount !== null &&
    (!Number.isFinite(row.amount) ||
      row.amount < 0 ||
      row.amount > 999999999999.99)
  )
    throw new Error('Enter a valid non-negative deal value.');
  if (
    row.contact_email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.contact_email)
  )
    throw new Error('Check the contact email address.');
  for (const value of [row.expected_close, row.next_action_on, row.meeting_on])
    if (value && !validDate(value))
      throw new Error('Use a valid date in YYYY-MM-DD format.');
  if (row.stage === 'lost' && !row.lost_reason.trim())
    throw new Error('Record why this deal was lost.');
  if (row.next_action_on && !row.next_action.trim())
    throw new Error('Describe the next action for its due date.');
  if (
    row.meeting_time &&
    (!row.meeting_on || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.meeting_time))
  )
    throw new Error(
      'Add a meeting date and use 24-hour time, for example 14:30.',
    );
}
export function blankDeal(): DealInput {
  return {
    title: '',
    contact_name: '',
    contact_email: '',
    company: '',
    stage: 'new',
    amount: null,
    expected_close: null,
    next_action: '',
    next_action_on: null,
    meeting_on: null,
    meeting_time: '',
    meeting_status: 'planned',
    meeting_notes: '',
    lost_reason: '',
    notes: '',
    quote_text: '',
    archived: false,
  };
}
export async function loadSales() {
  const { data, error } = await supabase
    .from('sales_deals')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(2001);
  if (error)
    throw new Error(
      'Could not load Sales. Check your connection and try again.',
    );
  if ((data?.length || 0) > 2000)
    throw new Error(
      'This workspace exceeds the 2,000-deal view limit. Ask support to enable pagination.',
    );
  return (data || []) as Deal[];
}
export async function saveDeal(input: DealInput, existing?: Deal) {
  const values = {
    ...input,
    title: input.title.trim(),
    contact_email: input.contact_email.trim(),
  };
  validateDeal(values);
  if (existing) {
    const { data, error } = await supabase
      .from('sales_deals')
      .update(values)
      .eq('id', existing.id)
      .eq('updated_at', existing.updated_at)
      .select('id');
    if (error)
      throw new Error(
        'Could not save this deal. Your access may have changed.',
      );
    if (!data?.length)
      throw new Error(
        'A teammate changed this deal. Close the editor, refresh, and open it again before saving.',
      );
  } else {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Sign in first.');
    const { error } = await supabase
      .from('sales_deals')
      .insert({ ...values, user_id: user.id });
    if (error)
      throw new Error(
        'Could not create the deal. Make sure your company access is approved.',
      );
  }
}
export async function loadTarget(month: string) {
  const { data, error } = await supabase
    .from('sales_targets')
    .select('*')
    .eq('month', month)
    .maybeSingle();
  if (error) throw new Error('Could not load the monthly target.');
  return data as SalesTarget | null;
}
export async function saveTarget(
  organizationId: string,
  month: string,
  revenue: number,
  deals: number,
  existing: SalesTarget | null,
) {
  if (
    !validDate(month) ||
    !month.endsWith('-01') ||
    !Number.isFinite(revenue) ||
    revenue < 0 ||
    revenue > 999999999999.99 ||
    !Number.isInteger(deals) ||
    deals < 0 ||
    deals > 1000000
  )
    throw new Error('Enter valid non-negative targets.');
  const values = { revenue_goal: revenue, deals_goal: deals };
  if (existing) {
    const { data, error } = await supabase
      .from('sales_targets')
      .update(values)
      .eq('organization_id', organizationId)
      .eq('month', month)
      .eq('updated_at', existing.updated_at)
      .select('month');
    if (error || !data?.length)
      throw new Error(
        'Target changed or access was denied. Refresh before saving.',
      );
  } else {
    const { error } = await supabase
      .from('sales_targets')
      .insert({ ...values, organization_id: organizationId, month });
    if (error)
      throw new Error(
        'Only the owner can set a target. Refresh if one already exists.',
      );
  }
}
export function salesSummary(rows: Deal[], today = localDate()) {
  const active = rows.filter((d) => !d.archived),
    open = active.filter((d) => !['won', 'lost'].includes(d.stage));
  const won = rows.filter(
    (d) =>
      d.stage === 'won' &&
      d.closed_at &&
      localDate(new Date(d.closed_at)).slice(0, 7) === today.slice(0, 7),
  );
  return {
    active,
    open,
    pipeline: open.reduce((s, d) => s + Number(d.amount || 0), 0),
    unknownValue: open.filter((d) => d.amount === null).length,
    won,
    wonValue: won.reduce((s, d) => s + Number(d.amount || 0), 0),
    due: open
      .filter((d) => d.next_action_on && d.next_action_on <= today)
      .sort((a, b) => a.next_action_on!.localeCompare(b.next_action_on!)),
    meetings: active
      .filter((d) => d.meeting_on && d.meeting_status === 'planned')
      .sort((a, b) =>
        (a.meeting_on! + a.meeting_time).localeCompare(
          b.meeting_on! + b.meeting_time,
        ),
      ),
  };
}
export const money = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(value);
export function quoteDraft(deal: DealInput) {
  return `DRAFT QUOTATION — review before sharing\n\nFor: ${deal.contact_name || '[Customer name]'}${deal.company ? ' · ' + deal.company : ''}\nRegarding: ${deal.title}\nDate: ${localDate()}\n\nScope / deliverables:\n[Describe the items or services included]\n\nAmount: ${deal.amount === null || !Number.isFinite(deal.amount) ? '[Enter amount]' : money(deal.amount)}\nTaxes / additional charges: [Specify if applicable]\nPayment terms: [Enter agreed terms]\nValid until: [Enter date]\n\nNotes:\n[Add inclusions, exclusions, and next steps]`;
}
const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return '"' + (/^[=+@\-\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"';
};
export function dealsCsv(rows: Deal[]) {
  return [
    [
      'Deal',
      'Contact',
      'Email',
      'Company',
      'Stage',
      'Value (INR)',
      'Expected close',
      'Next action',
      'Due',
      'Meeting date',
      'Meeting time',
      'Meeting outcome',
      'Lost reason',
      'Archived',
    ],
    ...rows.map((d) => [
      d.title,
      d.contact_name,
      d.contact_email,
      d.company,
      STAGE_LABELS[d.stage],
      d.amount,
      d.expected_close,
      d.next_action,
      d.next_action_on,
      d.meeting_on,
      d.meeting_time,
      d.meeting_status,
      d.lost_reason,
      d.archived,
    ]),
  ]
    .map((r) => r.map(csvCell).join(','))
    .join('\r\n');
}
