# Synq AI — database

Source of truth: `supabase/migrations/*.sql`, applied in filename order. Verified 2026-09-21.
TypeScript mirrors live in `src/types/database.ts` and must be updated with every schema change.

## Migrations

| File | Adds |
|---|---|
| `20260820000000_sales_agent_data_layer.sql` | `profiles`, `departments`, `leads`, `tasks`, RLS, `touch_updated_at`, `handle_new_user`, sales prompt function |
| `20260912000000_cold_call.sql` | `calls`, RLS, `sync_lead_status_from_call` trigger |
| `20260912010000_marketing_department.sql` | `campaigns`, `content_items`, `leads.campaign_id`, marketing prompt, seeds marketing department |
| `20260912020000_conversations.sql` | `conversations`, `messages`, assistant + CRM prompts, seeds `workspace` and `sales_crm` departments |
| `20260913000000_crm_agent_reads_crm.sql` | Replaces the CRM agent prompt |
| `20260913010000_sales_engine.sql` | `company_facts`, `sales_runs`, `prospects`, RLS |
| `20260913020000_autonomous_calling.sql` | Call-result columns on `prospects`, `attested_at`/`calls_placed`/`provider*` on `sales_runs`, new status sets |
| `20260913030000_video_generation.sql` | `videos`, private `videos` storage bucket + owner policies |
| `20260913050000_call_audio.sql` | Private `call-audio` storage bucket (no policies; service-role only) |
| `20260915010000_do_not_call.sql` | `prospects.do_not_call` |

## Tables

### `profiles`
`id` (PK, FK `auth.users`), `business_name`, `created_at`. One row per user, seeded on signup.

### `departments`
`id`, `user_id`, `department_type`, `display_name`, `system_instructions`, `config` jsonb,
`created_at`. Unique `(user_id, department_type)`. Seeded types: **`sales`, `marketing`,
`workspace`, `sales_crm`**. `system_instructions` is the agent's prompt and is read server-side
only.

### `leads`
`id`, `user_id`, `department_id`, `campaign_id`, `name`, `phone`, `email`, `company`, `notes`,
`status` (`new|contacted|qualified|disqualified`), `created_at`, `updated_at` (trigger).

### `tasks`
`id`, `user_id`, `department_id`, `task_type`, `input` jsonb, `output`, `status`
(`pending|running|completed|failed`), `created_at`, `completed_at`. Written by `run-task`.

### `calls`
`id`, `user_id`, `lead_id`, `outcome` (`interested|not_interested|call_back|no_answer|
wrong_number|qualified`), `notes`, `follow_up_on` (date), `created_at`.
Trigger `calls_sync_lead_status` updates `leads.status` from the outcome.

### `campaigns`, `content_items`
Full marketing CRUD schema with RLS. **No application code touches these tables today.**

### `conversations`
`id`, `user_id`, `department_id`, `kind` (`assistant|sales_ai|crm|content|campaign`), `title`,
`context` jsonb, `created_at`, `updated_at`.

### `messages`
`id`, `conversation_id`, `user_id`, `role` (`user|model` — Gemini's naming), `content`,
`created_at`. Insert policy requires the parent conversation to belong to the caller.

### `company_facts`
`id`, `user_id`, `category` (`about|service|pricing|policy|proof`), `label`, `content`, timestamps.
**No UI.**

### `sales_runs`
`id`, `user_id`, `request`, `objective`, `pitch`, `location`, `industry`, `target_count` (1–200),
`source`, `status`, `blocked_reason`, `report`, `attested_at`, `calls_placed`, `provider`,
`provider_batch_id`, `created_at`, `updated_at`, `completed_at`.

Current status set (after `20260913020000`): `planning`, `discovering`, `screening`,
`awaiting_approval`, `calling`, `completed`, `blocked`, `failed`.

`attested_at` is the human approval gate: `place-calls` refuses a run without it.

### `prospects`
`id`, `user_id`, `run_id`, `lead_id`, `name`, `phone`, `website`, `address`, `category`, `source`,
`source_ref`, `eligibility` (`pending|eligible|excluded`), `eligibility_reason`, `outreach_status`
(`pending|dialing|called|skipped|failed`), `call_notes`, `temperature` (`hot|warm|cold`),
`transcript_summary`, `conversation_id`, `provider_call_id`, `called_at`, `call_error`,
`do_not_call`, `created_at`.

`source` is `not null` on purpose: a prospect with no provenance would be a fabricated business.

### `videos`
`id`, `user_id`, `conversation_id`, `prompt`, `aspect_ratio` (`16:9|9:16`), `duration_seconds`
(4|6|8), `resolution` (`720p|1080p`), `status` (`pending|generating|ready|failed`),
`operation_name`, `storage_path`, `error`, timestamps.

### `app_admins`

The accounts allowed to read across users. `user_id` (PK → `auth.users`), `role` (`ceo` | `admin`),
`note`, `granted_at`.

Select policy: `private.is_admin(auth.uid())` — i.e. only an admin can see the list. **There is no
insert, update or delete policy**, so membership can only be changed with the service-role key:

```sql
-- grant
insert into public.app_admins (user_id, role, note)
select id, 'admin', 'why they have it' from auth.users where email = 'someone@example.com';
-- revoke
delete from public.app_admins
where user_id = (select id from auth.users where email = 'someone@example.com');
```

Seeded with `synq.ai.official@gmail.com` (`ceo`) by the migration, plus
`vishakh.jaligama@gmail.com` (`admin`, the owner's working account) granted on 2026-09-21.

### `events`

The platform timeline. `id`, `user_id` (null for platform-level events), `source`, `kind`
(dotted, e.g. `task.failed`), `severity` (`info` | `warning` | `error`), `summary` (one line,
already written for a human, truncated to 300 chars), `subject_id`, `meta` jsonb, `created_at`.

Indexes: `(created_at desc)`, a partial `(created_at desc) where severity <> 'info'`,
`(user_id, created_at desc)`, `(kind, created_at desc)`.

Policies: a user selects their own rows; an admin selects all. **No insert policy** — rows come
only from the triggers below (security definer) and the service role.

## Relationships

```
auth.users ─1:1─ profiles
           ─1:N─ departments (unique per type)
           ─1:N─ leads ─1:N─ calls
           ─1:N─ tasks
           ─1:N─ conversations ─1:N─ messages
                              └─1:N─ videos
           ─1:N─ sales_runs ─1:N─ prospects ─0:1─ leads
```

## RLS

Every table has RLS enabled with select/insert/update/delete policies scoped to
`(select auth.uid()) = user_id`. Update policies carry both `using` and `with check` so a row cannot
be reassigned to another user. Child tables (`prospects`, `messages`, `videos`) additionally use an
`exists` check on the parent so a forged parent id cannot drop rows into someone else's thread/run.

`app_admins` and `events` are the two exceptions to "scoped to `user_id`": both also allow
`private.is_admin(auth.uid())`, which is how the CEO console reads across accounts. This
`security definer` helper is outside the exposed API schemas and only returns true for the
authenticated caller's own id.

Proof scripts, both run by pasting into the Supabase SQL editor:

- `supabase/tests/rls_isolation_test.sql` — creates two throwaway users, tries every cross-user
  access, prints PASS/FAIL, rolls back.
- `supabase/tests/admin_access_test.sql` — asserts that an admin sees every event, an ordinary user
  sees only their own, an ordinary user cannot read `app_admins` at all, a signed-out visitor sees
  nothing, and nobody with a session can write the audit log. Raises if any of that stops holding.
  Last run 2026-09-21: all five passed.

## Storage buckets

| Bucket | Public | Limits | Access |
|---|---|---|---|
| `videos` | no | see migration | owner-scoped select/delete policies; service role writes |
| `call-audio` | no | 5 MB, `audio/mpeg` | no policies at all; only the `call-audio` function (service role) writes, readers get a 1-hour signed URL |

## Functions and triggers

- `public.touch_updated_at()` — generic `updated_at` trigger, used by leads, campaigns,
  content_items, conversations, company_facts, sales_runs, videos.
- `public.handle_new_user()` — on `auth.users` insert, creates the profile and the four department
  rows. Direct `EXECUTE` is revoked from `public`, `anon`, and `authenticated`; the auth trigger
  still invokes it.
- `public.sync_lead_status_from_call()` — maps a call outcome onto `leads.status`.
- `private.is_admin(uuid)` — `security definer`, used by the `app_admins` and `events` policies.
  The private schema is not exposed through PostgREST; execute is revoked from `public`/`anon`.
- `public.log_event(...)` — `security definer` writer for `events`. Execute is revoked from
  `authenticated` as well: only the triggers and the service role can write history.
- `public.events_from_tasks/_videos/_calls/_leads/_sales_runs/_prospects/_conversations/_profiles()`
  — AFTER triggers that turn row changes into `events`. Each one ends in
  `exception when others then return null`, so a logging failure can never fail the user's write.
  Direct `EXECUTE` is revoked from client roles. Adding a table to the timeline means adding one
  more of these, not touching app code.
- Prompt functions: `sales_agent_system_instructions()`, `marketing_agent_system_instructions()`,
  `assistant_system_instructions()`, `crm_agent_system_instructions()`. Changing a prompt means
  replacing the function and re-running the backfill `insert … on conflict do update` at the bottom
  of the relevant migration.

## Applying changes

The Supabase CLI is not logged in in this environment. Use the Supabase MCP `apply_migration`
(DDL) and `execute_sql` (queries) tools against project `jjdrlgwpvxyxeruyygli`, and write the same
SQL into a new file in `supabase/migrations/` so the repo stays the source of truth.
