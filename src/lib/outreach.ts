import { supabase } from '@/lib/supabase';

export type RecipientInput = { email: string; name: string };
export type OutreachAnalysis = {
  summary: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  intent: 'interested' | 'not_interested' | 'needs_information' | 'unclear';
  answers: { question: string; answer: string | null }[];
  themes: string[];
  next_step: string;
  opted_out: boolean;
};
export type OutreachReport = {
  total: number;
  sent: number;
  received: number;
  replied: number;
  waiting: number;
  failed: number;
  uncertain: number;
  queued: number;
  response_rate: number;
  analyzed: number;
  sentiment: Record<string, number>;
  themes: { label: string; count: number }[];
  replied_to: string[];
  awaiting_reply: string[];
  questions: { question: string; answered: number }[];
  next_steps: {
    email: string;
    name: string;
    summary: string;
    next_step: string;
    intent: string;
    opted_out: boolean;
  }[];
  generated_at: string;
};
export type OutreachCampaign = {
  id: string;
  user_id: string;
  organization_id: string | null;
  title: string;
  goal: string;
  questions: string[];
  subject: string;
  body: string;
  sender_email: string | null;
  status: 'draft' | 'active' | 'paused' | 'completed';
  report: OutreachReport | null;
  report_at: string | null;
  sync_error: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};
export type OutreachRecipient = {
  id: string;
  campaign_id: string;
  email: string;
  name: string;
  status: 'queued' | 'sending' | 'sent' | 'replied' | 'failed' | 'uncertain';
  sent_at: string | null;
  last_reply_at: string | null;
  analysis: OutreachAnalysis | null;
  analysis_message_count: number;
  analysis_error: string | null;
  error: string | null;
};
export type OutreachMessage = {
  id: string;
  recipient_id: string;
  sender: string;
  body: string;
  received_at: string;
  is_auto_reply: boolean;
};
export type GmailStatus = {
  connected: boolean;
  email: string | null;
  configured: boolean;
};
export type CampaignInput = {
  title: string;
  goal: string;
  questions: string[];
  subject: string;
  body: string;
  recipients: RecipientInput[];
};

async function invoke<T>(
  fn: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let detail = '';
    const response = (error as { context?: Response }).context;
    try {
      if (response?.json) detail = (await response.json()).error || '';
    } catch {
      /* Use actionable fallback below. */
    }
    throw new Error(
      detail ||
        'Email outreach could not be reached. Check its server setup and your connection.',
    );
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}
export const gmailStatus = () =>
  invoke<GmailStatus>('gmail-auth', { action: 'status' });
export const connectGmail = (origin: string) =>
  invoke<{ url: string }>('gmail-auth', {
    action: 'connect',
    return_url: origin,
  });
export const disconnectGmail = () =>
  invoke('gmail-auth', { action: 'disconnect' });
export const suggestEmailQuestions = (goal: string) =>
  invoke<{ questions: string[] }>('email-outreach', {
    action: 'suggest',
    goal,
  });
export const draftEmail = (input: {
  goal: string;
  questions: string[];
  tone: string;
  instructions: string;
}) =>
  invoke<{ subject: string; body: string }>('email-outreach', {
    action: 'draft',
    ...input,
  });
export const createCampaign = (input: CampaignInput) =>
  invoke<{ id: string }>('email-outreach', { action: 'create', ...input });
export const campaignAction = (
  id: string,
  action: 'send' | 'pause' | 'sync' | 'report',
) =>
  invoke<{ report?: OutreachReport; busy?: boolean }>('email-outreach', {
    action,
    campaign_id: id,
    ...(action === 'send' ? { confirmed: true } : {}),
  });

export async function listCampaigns(): Promise<OutreachCampaign[]> {
  const { data, error } = await supabase
    .from('outreach_campaigns')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error)
    throw new Error(
      'Could not load campaigns. Email outreach storage may need setup.',
    );
  return data || [];
}
export async function campaignDetail(
  id: string,
): Promise<{ recipients: OutreachRecipient[]; messages: OutreachMessage[] }> {
  const { data: recipients, error } = await supabase
    .from('outreach_recipients')
    .select('*')
    .eq('campaign_id', id)
    .order('email');
  if (error) throw new Error('Could not load recipients.');
  if (!recipients?.length) return { recipients: [], messages: [] };
  const { data: messages, error: messageError } = await supabase
    .from('outreach_messages')
    .select('*')
    .in(
      'recipient_id',
      recipients.map((r) => r.id),
    )
    .order('received_at', { ascending: false });
  if (messageError) throw new Error('Could not load saved replies.');
  return { recipients, messages: messages || [] };
}
export function parseBulkRecipients(value: string): RecipientInput[] {
  // One address or Name <address> per entry. Email+name rows stay editable
  // after import; duplicate addresses never create extra sends.
  const result = new Map<string, RecipientInput>();
  for (const entry of value
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const match = entry.match(/^(.*?)\s*<([^<>]+)>$/);
    const email = (match ? match[2] : entry).trim().toLowerCase();
    const name = (match ? match[1] : '').trim();
    if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email))
      throw new Error(`Check this email address: ${entry}`);
    if (name.length > 100)
      throw new Error('Recipient names must be under 100 characters.');
    if (!result.has(email)) result.set(email, { email, name });
  }
  if (!result.size || result.size > 50)
    throw new Error('Paste between 1 and 50 unique email addresses.');
  return [...result.values()];
}
export function outreachStats(
  recipients: OutreachRecipient[],
  messages: OutreachMessage[],
) {
  const sent = recipients.filter((r) => r.sent_at).length;
  const replied = recipients.filter((r) => r.status === 'replied').length;
  return {
    total: recipients.length,
    sent,
    replied,
    received: messages.filter((m) => !m.is_auto_reply).length,
    waiting: recipients.filter((r) => r.status === 'sent').length,
    failed: recipients.filter((r) => r.status === 'failed').length,
    queued: recipients.filter((r) => r.status === 'queued').length,
    responseRate: sent ? Math.round((replied / sent) * 100) : 0,
  };
}
const csvCell = (value: unknown) => {
  const s = String(value ?? '');
  return '"' + (/^[=+@\-\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"';
};
export function exportCampaignCsv(
  campaign: OutreachCampaign,
  recipients: OutreachRecipient[],
) {
  const rows: unknown[][] = [
    [
      'Campaign',
      'Email',
      'Name',
      'Status',
      'Sent at',
      'Last reply',
      'Summary',
      'Sentiment',
      'Intent',
      ...campaign.questions,
      'Next step',
    ],
  ];
  for (const r of recipients)
    rows.push([
      campaign.title,
      r.email,
      r.name,
      r.status,
      r.sent_at,
      r.last_reply_at,
      r.analysis?.summary,
      r.analysis?.sentiment,
      r.analysis?.intent,
      ...campaign.questions.map(
        (_, i) => r.analysis?.answers[i]?.answer || 'Not answered',
      ),
      r.analysis?.next_step,
    ]);
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
