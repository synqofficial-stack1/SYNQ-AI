import { supabase } from '@/lib/supabase';
import { runTask } from '@/lib/tasks';
import type { Campaign, CampaignStatus, ContentItem, ContentStatus, ContentType } from '@/types/database';

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export async function listCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Campaign[];
}

export async function createCampaign(input: {
  name: string;
  goal?: string;
  audience?: string;
  channels?: string[];
  plan?: string;
  status?: CampaignStatus;
}): Promise<Campaign> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) throw new Error('You are signed out. Log in and try again.');

  const { data: department } = await supabase
    .from('departments')
    .select('id')
    .eq('user_id', user.id)
    .eq('department_type', 'marketing')
    .maybeSingle();

  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      user_id: user.id,
      department_id: department?.id ?? null,
      name: input.name,
      goal: input.goal || null,
      audience: input.audience || null,
      channels: input.channels ?? [],
      plan: input.plan || null,
      status: input.status ?? 'draft',
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data as Campaign;
}

export async function updateCampaign(
  id: string,
  patch: Partial<Pick<Campaign, 'name' | 'goal' | 'audience' | 'channels' | 'plan' | 'status'>>
): Promise<void> {
  const { error } = await supabase.from('campaigns').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export async function listContent(campaignId?: string): Promise<ContentItem[]> {
  let query = supabase.from('content_items').select('*');
  if (campaignId) query = query.eq('campaign_id', campaignId);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ContentItem[];
}

export async function createContentItem(input: {
  title: string;
  body?: string;
  contentType: ContentType;
  channel?: string;
  campaignId?: string | null;
  status?: ContentStatus;
  sourceItemId?: string | null;
}): Promise<ContentItem> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) throw new Error('You are signed out. Log in and try again.');

  const { data, error } = await supabase
    .from('content_items')
    .insert({
      user_id: user.id,
      title: input.title,
      body: input.body || null,
      content_type: input.contentType,
      channel: input.channel || null,
      campaign_id: input.campaignId ?? null,
      status: input.status ?? 'draft',
      source_item_id: input.sourceItemId ?? null,
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data as ContentItem;
}

export async function updateContentItem(
  id: string,
  patch: Partial<Pick<ContentItem, 'title' | 'body' | 'channel' | 'status' | 'scheduled_for' | 'campaign_id'>>
): Promise<void> {
  const { error } = await supabase.from('content_items').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

export type MarketingSummary = {
  campaignCount: number;
  activeCampaigns: number;
  contentCount: number;
  scheduledContent: number;
  approvedUnscheduled: number;
  leadsFromCampaigns: number;
  /** Plain sentences about the workspace, each one backed by a count above. */
  brief: string[];
  recommendations: { title: string; reason: string; path: string }[];
};

/**
 * Deliberately not an AI call. Every line here is arithmetic over rows the user
 * owns, so it cannot drift into invented performance claims — and it renders
 * instantly. The AI is reserved for work that actually needs writing.
 *
 * Reach, impressions, engagement and cost-per-lead are absent because nothing in
 * this system measures them; they need a channel integration first.
 */
export async function loadMarketingSummary(): Promise<MarketingSummary> {
  const [campaignsResult, contentResult, leadsResult] = await Promise.all([
    supabase.from('campaigns').select('id, status'),
    supabase.from('content_items').select('id, status, scheduled_for'),
    supabase.from('leads').select('id', { count: 'exact', head: true }).not('campaign_id', 'is', null),
  ]);

  if (campaignsResult.error) throw new Error(campaignsResult.error.message);
  if (contentResult.error) throw new Error(contentResult.error.message);

  const campaigns = campaignsResult.data ?? [];
  const content = contentResult.data ?? [];

  const activeCampaigns = campaigns.filter((c) => c.status === 'active').length;
  const scheduledContent = content.filter((c) => c.status === 'scheduled').length;
  const approvedUnscheduled = content.filter(
    (c) => c.status === 'approved' && !c.scheduled_for
  ).length;
  const leadsFromCampaigns = leadsResult.error ? 0 : (leadsResult.count ?? 0);

  const brief: string[] = [];
  if (campaigns.length === 0) {
    brief.push('No campaigns yet. Creating one is the place to start.');
  } else {
    brief.push(
      `${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'}, ${activeCampaigns} active.`
    );
  }
  if (content.length > 0) {
    brief.push(
      `${content.length} content item${content.length === 1 ? '' : 's'}, ${scheduledContent} scheduled.`
    );
  }
  brief.push(
    leadsFromCampaigns > 0
      ? `${leadsFromCampaigns} lead${leadsFromCampaigns === 1 ? '' : 's'} attributed to a campaign, all visible to Sales.`
      : 'No campaign-attributed leads yet.'
  );

  const recommendations: MarketingSummary['recommendations'] = [];
  if (approvedUnscheduled > 0) {
    recommendations.push({
      title: 'Schedule approved content',
      reason: `${approvedUnscheduled} item${approvedUnscheduled === 1 ? ' is' : 's are'} approved but has no date.`,
      path: '/content',
    });
  }
  if (campaigns.length > 0 && content.length === 0) {
    recommendations.push({
      title: 'Create content for your campaign',
      reason: 'You have a campaign but nothing written for it yet.',
      path: '/content',
    });
  }
  if (campaigns.length === 0) {
    recommendations.push({
      title: 'Plan your first campaign',
      reason: 'Marketing AI can draft a full plan from a one-line goal.',
      path: '/campaigns',
    });
  }

  return {
    campaignCount: campaigns.length,
    activeCampaigns,
    contentCount: content.length,
    scheduledContent,
    approvedUnscheduled,
    leadsFromCampaigns,
    brief,
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export async function generateCampaignPlan(input: {
  goal: string;
  audience?: string;
  channels?: string[];
}): Promise<string> {
  const brief = [
    `Goal: ${input.goal}`,
    input.audience ? `Audience: ${input.audience}` : '',
    input.channels?.length ? `Preferred channels: ${input.channels.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const { output } = await runTask({ taskType: 'plan_campaign', notes: brief });
  return output;
}

export async function generateContentDraft(input: {
  contentType: string;
  channel: string;
  topic: string;
  goal?: string;
  tone?: string;
  audience?: string;
}): Promise<string> {
  const brief = [
    `Format: ${input.contentType}`,
    `Channel: ${input.channel}`,
    `Topic: ${input.topic}`,
    input.goal ? `Goal: ${input.goal}` : '',
    input.tone ? `Tone: ${input.tone}` : '',
    input.audience ? `Audience: ${input.audience}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const { output } = await runTask({ taskType: 'draft_content', notes: brief });
  return output;
}

export async function repurposeContent(input: {
  source: string;
  formats: string[];
}): Promise<string> {
  const { output } = await runTask({
    taskType: 'repurpose_content',
    notes: input.source,
    extraInstructions: `Produce these formats: ${input.formats.join(', ')}.`,
  });
  return output;
}

export async function generateContentIdeas(input: {
  topic: string;
  audience?: string;
}): Promise<string> {
  const brief = [`Topic: ${input.topic}`, input.audience ? `Audience: ${input.audience}` : '']
    .filter(Boolean)
    .join('\n');

  const { output } = await runTask({ taskType: 'content_ideas', notes: brief });
  return output;
}
