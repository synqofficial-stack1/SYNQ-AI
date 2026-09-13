// Shapes of the four tables created in
// supabase/migrations/20260820000000_sales_agent_data_layer.sql.
// Hand-written rather than generated so there is no extra tooling to install;
// if the migration changes, change this too.

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'disqualified'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const TASK_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type Profile = {
  id: string;
  business_name: string | null;
  created_at: string;
};

export type Department = {
  id: string;
  user_id: string;
  department_type: string;
  display_name: string;
  system_instructions: string;
  config: Record<string, unknown>;
  created_at: string;
};

export type Lead = {
  id: string;
  user_id: string;
  department_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  notes: string | null;
  status: LeadStatus;
  created_at: string;
  updated_at: string;
};

export type Task = {
  id: string;
  user_id: string;
  department_id: string | null;
  task_type: string;
  input: Record<string, unknown>;
  output: string | null;
  status: TaskStatus;
  created_at: string;
  completed_at: string | null;
};

/** Fields the client supplies when creating a lead; the rest are DB defaults. */
export type NewLead = Pick<Lead, 'name' | 'phone' | 'email' | 'company' | 'notes'>;

// From supabase/migrations/20260912000000_cold_call.sql.
export const CALL_OUTCOMES = [
  'interested',
  'call_back',
  'no_answer',
  'not_interested',
  'wrong_number',
  'qualified',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  interested: 'Interested',
  call_back: 'Call back',
  no_answer: 'No answer',
  not_interested: 'Not interested',
  wrong_number: 'Wrong number',
  qualified: 'Qualified',
};

export type Call = {
  id: string;
  user_id: string;
  lead_id: string;
  outcome: CallOutcome;
  notes: string | null;
  follow_up_on: string | null;
  created_at: string;
};

// From supabase/migrations/20260912010000_marketing_department.sql.
export const CAMPAIGN_STATUSES = ['draft', 'planning', 'active', 'paused', 'completed'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Draft',
  planning: 'Planning',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
};

export type Campaign = {
  id: string;
  user_id: string;
  department_id: string | null;
  name: string;
  goal: string | null;
  audience: string | null;
  channels: string[];
  budget: number | null;
  start_date: string | null;
  end_date: string | null;
  plan: string | null;
  status: CampaignStatus;
  created_at: string;
  updated_at: string;
};

export const CONTENT_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'scheduled',
  'published',
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const CONTENT_STATUS_LABELS: Record<ContentStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
};

export const CONTENT_TYPES = [
  'social_post',
  'blog_post',
  'email',
  'ad_copy',
  'landing_page',
  'video_script',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  social_post: 'Social post',
  blog_post: 'Blog post',
  email: 'Email',
  ad_copy: 'Ad copy',
  landing_page: 'Landing page',
  video_script: 'Video script',
};

export const MARKETING_CHANNELS = [
  'LinkedIn',
  'Instagram',
  'X',
  'Email',
  'Website',
  'Blog',
  'Advertising',
] as const;

export type ContentItem = {
  id: string;
  user_id: string;
  campaign_id: string | null;
  title: string;
  body: string | null;
  content_type: ContentType;
  channel: string | null;
  status: ContentStatus;
  scheduled_for: string | null;
  source_item_id: string | null;
  created_at: string;
  updated_at: string;
};

// From supabase/migrations/20260913010000_sales_engine.sql.
export const FACT_CATEGORIES = ['about', 'service', 'pricing', 'policy', 'proof'] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

export const FACT_CATEGORY_LABELS: Record<FactCategory, string> = {
  about: 'About the business',
  service: 'What you sell',
  pricing: 'Pricing',
  policy: 'Policies',
  proof: 'Proof and results',
};

export type CompanyFact = {
  id: string;
  user_id: string;
  category: FactCategory;
  label: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export const RUN_STATUSES = [
  'planning',
  'discovering',
  'screening',
  'awaiting_approval',
  'calling',
  'completed',
  'blocked',
  'failed',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  planning: 'Planning',
  discovering: 'Searching Google Maps',
  screening: 'Checking the list',
  awaiting_approval: 'Waiting for your approval',
  calling: 'Calling',
  completed: 'Done',
  blocked: 'Needs attention',
  failed: 'Failed',
};

export type SalesRun = {
  id: string;
  user_id: string;
  request: string;
  objective: string | null;
  pitch: string | null;
  location: string | null;
  industry: string | null;
  target_count: number;
  source: string;
  status: RunStatus;
  blocked_reason: string | null;
  report: string | null;
  /** Set when the user confirmed the list. Null means nothing may be dialled. */
  attested_at: string | null;
  calls_placed: number;
  provider: string | null;
  provider_batch_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type ProspectEligibility = 'pending' | 'eligible' | 'excluded';
export type ProspectOutreach = 'pending' | 'dialing' | 'called' | 'skipped' | 'failed';

/** How the call went. Null until a call has actually connected and been read. */
export type Temperature = 'hot' | 'warm' | 'cold';

export const TEMPERATURE_LABELS: Record<Temperature, string> = {
  hot: 'Hot',
  warm: 'Warm',
  cold: 'Cold',
};

export type Prospect = {
  id: string;
  user_id: string;
  run_id: string;
  lead_id: string | null;
  name: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  category: string | null;
  source: string;
  source_ref: string | null;
  eligibility: ProspectEligibility;
  eligibility_reason: string | null;
  outreach_status: ProspectOutreach;
  /** Written by the post-call webhook from the real transcript, never guessed. */
  call_notes: string | null;
  temperature: Temperature | null;
  transcript_summary: string | null;
  conversation_id: string | null;
  provider_call_id: string | null;
  called_at: string | null;
  call_error: string | null;
  created_at: string;
};
