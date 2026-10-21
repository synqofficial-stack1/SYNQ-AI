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
export const organizationPeople = () =>
  rpc<OrganizationPerson[]>('organization_people');
export const reviewOrganizationMember = (
  userId: string,
  decision: 'approve' | 'reject' | 'remove',
) =>
  rpc('review_organization_member', { p_user: userId, p_decision: decision });
