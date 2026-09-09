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
