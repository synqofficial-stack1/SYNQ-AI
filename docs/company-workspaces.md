# Company workspaces

Sign-up asks for the user's full name. After password or Google sign-in, account
setup asks for the company name and whether the user is its owner or a teammate.
Existing accounts also complete this step before entering the workspace.

The first owner creates the workspace. Company names are matched without case or
repeated whitespace. This is a self-declared workspace owner, not verification
of a legal company's identity. Choosing “owner” for an existing company still
creates a pending member request; it never replaces the current owner.

Pending users cannot enter the company workspace. The owner sees an in-app
notification/banner and approves or rejects requests on the Company page. No
approval email is sent. Pending users can check status or change their request.

Approved members share leads, email duties, stored replies, and reports. Setup
explains that existing personal leads and duties join the company upon creation
or approval. These records retain their company after a member is removed.
Personal AI chats and Gmail credentials stay private. Only the original sender
can send, pause, or sync a duty; teammates can read results and generate reports.

The owner can remove a teammate with confirmation. Removal revokes access to
company records and pauses that person's active company email duties. An email
already in flight may still complete. The worker checks approved sender
membership before accessing Gmail. Owner transfer/account deletion are not
implemented in this flow.

## Implementation and checks

- Apply `20261021090000_company_workspaces.sql` after the email migrations.
- Redeploy `email-outreach` and `email-worker` with their shared modules.
- Access is enforced in database RLS and security-definer RPCs with a fixed
  search path. Clients cannot change roles, approval status, or asset tenancy.
- `supabase/tests/company_workspaces.sql` runs in a rollback-only transaction:
  owner takeover prevention, pending denial, owner-only approval, company
  isolation, shared leads/replies, tenant immutability, and access removal.
- Email provider mocks verify teammates cannot operate another sender's Gmail
  and removed senders are paused before contacting Gmail.
- Manual acceptance: create a company with one account, request membership with
  another, approve it, verify shared records, then remove and confirm denial.
  Real OAuth/delivery still needs a separate, authorized pilot test.
