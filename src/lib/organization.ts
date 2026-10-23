import { supabase } from '@/lib/supabase';

export type WorkspaceIdentity = {
  full_name: string | null;
  membership: null | {
    organization_id: string;
    company_name: string;
    role: 'owner' | 'member';
    status: 'active' | 'pending' | 'rejected' | 'removed';
    pending_count: number;
  };
};
export type OrganizationPerson = {
  user_id: string;
  name: string | null;
  email: string;
  role: 'owner' | 'member';
  status: 'active' | 'pending' | 'rejected' | 'removed';
  requested_at: string;
};
export type WorkspaceMember = { user_id: string; display_name: string; is_current_user: boolean };
export type WorkspaceChatMessage = { id: string; sender_id: string; body: string; created_at: string };
export type WorkspaceTask = {
  id: string; created_by: string; assigned_to: string; title: string; details: string;
  status: 'open' | 'in_progress' | 'completed'; due_at: string | null; created_at: string; updated_at: string;
};
export function newWorkspaceRecordId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}
async function rpc<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error)
    throw new Error(error.message || 'Company workspace is unavailable.');
  return data as T;
}
export const loadWorkspaceIdentity = () =>
  rpc<WorkspaceIdentity>('workspace_identity');
export const setupWorkspace = (name: string, company: string, owner: boolean) =>
  rpc<WorkspaceIdentity>('setup_workspace', {
    p_name: name,
    p_company: company,
    p_owner: owner,
  });
export const organizationPeople = async () =>
  (await rpc<OrganizationPerson[] | null>('organization_people')) ?? [];
export const reviewOrganizationMember = (
  userId: string,
  decision: 'approve' | 'reject' | 'remove',
) =>
  rpc('review_organization_member', { p_user: userId, p_decision: decision });

export const activeWorkspaceMembers = async () =>
  (await rpc<WorkspaceMember[] | null>('organization_active_members')) ?? [];

export async function loadWorkspaceChat() {
  const { data, error } = await supabase.from('organization_chat_messages')
    .select('id,sender_id,body,created_at').order('created_at', { ascending: false }).limit(50);
  if (error) throw new Error('Could not load company messages.');
  return (data ?? []).reverse() as WorkspaceChatMessage[];
}

export async function sendWorkspaceMessage(body: string, organizationId: string, messageId?: string) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Sign in before sending a company message.');
  const id = messageId || newWorkspaceRecordId();
  const { error } = await supabase.from('organization_chat_messages').insert({ id, organization_id: organizationId, sender_id: auth.user.id, body: body.trim() });
  if (error) throw new Error(error.message.includes('organization_chat_messages') ? 'Apply the company collaboration migration before using team chat.' : 'Could not send the message. Check your company access and try again.');
}

export async function loadWorkspaceTasks() {
  const { data, error } = await supabase.from('organization_tasks').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error('Could not load assigned work.');
  return (data ?? []) as WorkspaceTask[];
}

export async function createWorkspaceTask(input: { id: string; organization_id: string; assigned_to: string; title: string; details: string; due_at: string | null }) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Sign in before assigning work.');
  const { error } = await supabase.from('organization_tasks').insert({ ...input, created_by: auth.user.id });
  if (error?.code === '23505') {
    const { data } = await supabase.from('organization_tasks').select('id').eq('id', input.id).maybeSingle();
    if (data?.id === input.id) return;
  }
  if (error) throw new Error(error.message.includes('organization_tasks') ? 'Apply the company collaboration migration before assigning work.' : 'Could not assign this task. Check that the assignee is an active company member.');
}

export async function setWorkspaceTaskStatus(id: string, status: WorkspaceTask['status']) {
  const { data, error } = await supabase.from('organization_tasks').update({ status }).eq('id', id).select('id');
  if (error) throw new Error('Could not update this task. Check your workspace access and retry.');
  // RLS turns a disallowed update into zero rows rather than an error.
  if (!data?.length) throw new Error('Only the person who created this task, its assignee, or the workspace owner can change it.');
}

export async function loadSalesMeetings() {
  const { data: meetings, error } = await supabase.from('sales_meetings').select('*').order('starts_at', { ascending: true }).limit(100);
  if (error) throw new Error('Could not load meetings. Apply the company collaboration migration if this is a new environment.');
  const ids = (meetings ?? []).map((meeting) => meeting.id);
  const attendeeRows = ids.length ? await supabase.from('sales_meeting_attendees').select('meeting_id,user_id').in('meeting_id', ids) : { data: [], error: null };
  if (attendeeRows.error) throw new Error('Could not load meeting participants.');
  return (meetings ?? []).map((meeting) => ({
    ...meeting,
    attendee_ids: (attendeeRows.data ?? []).filter((row) => row.meeting_id === meeting.id).map((row) => row.user_id),
  }));
}

export async function createSalesMeeting(input: { requestId: string; title: string; description: string; startsAt: string; attendees: string[] }) {
  const { data, error } = await supabase.rpc('create_sales_meeting', {
    p_request_id: input.requestId, p_title: input.title, p_description: input.description, p_starts_at: input.startsAt, p_attendees: input.attendees,
  });
  if (error || !data) throw new Error(error?.message || 'Could not save the meeting.');
  return data as string;
}

export async function updateSalesMeetingAttendees(meetingId: string, attendees: string[]) {
  const { error } = await supabase.rpc('update_sales_meeting_attendees', { p_meeting: meetingId, p_attendees: attendees });
  if (error) throw new Error(error.message || 'Could not update meeting participants.');
}
