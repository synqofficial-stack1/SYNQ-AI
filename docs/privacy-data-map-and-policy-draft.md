# Synq data map and privacy policy draft

Status: engineering draft only. This is not legal advice and is not a published policy. All bracketed items and retention practices must be confirmed by the product owner and qualified counsel before publication.

**Superseded in part (2026-10-22):** the user-facing policy now lives at `src/app/privacy.tsx` (route `/privacy`), with owner details in `src/constants/legal.ts`; Google Play answers are in `docs/play-store-listing.md`. Account deletion is now live (Settings → Delete account, `/delete-account`, `supabase/functions/delete-account`, migration `20261022093743`). The inventory below is kept as the engineering record of data flows.

## Verified data-flow inventory

| Data | Purpose | Code-backed location / provider | Account association | Retention / control status |
|---|---|---|---|---|
| Email, authentication identifiers, password verifier, sessions, provider identity | Create and authenticate accounts, password recovery | Supabase Auth; `src/lib/auth.ts`; auth routes | Yes | Supabase Auth lifecycle configured in dashboard; account deletion is not implemented; exact retention unverified. |
| Name and onboarding preferences | Workspace setup and personalization | Auth metadata/profile and onboarding tables; `src/lib/onboarding.ts`, `supabase/migrations/20261010153633_onboarding_flow.sql` | Yes | Account deletion/retention not verified. Apple name is provided only on first native authorization and the new flow saves it to Auth metadata. |
| Leads, contact names/emails/phones, CRM notes, tasks, activity, workspace/team membership | Sales workspace and follow-up management | Supabase Postgres; `src/lib/leads.ts`, `src/lib/sales-workspace.ts`, `src/lib/organization.ts`, migrations | Yes; may be workspace-shared | Workspace deletion and owner transfer behavior require review; retention not documented. |
| AI prompts, conversation messages, outputs, usage/credit records | Generate assistance and meter usage | Supabase Postgres + Edge Functions; Gemini/provider APIs; `src/lib/chat.ts`, `supabase/functions/chat`, `supabase/functions/run-task`, AI migrations | Yes | Provider retention settings, training use, and product deletion schedule require verification. |
| Generated images/video and user media uploads | Generate, store, and publish media | Supabase Storage buckets `ai-images`, `marketing-uploads`, `call-audio`; Gemini/Pollinations/fal.ai and social APIs; `src/lib/images.ts`, `src/components/marketing-publisher.tsx`, Edge Functions | Yes; workspace sharing may apply | Storage is private in code paths inspected; complete deletion, provider retention, backup retention, and shared media rules are unverified. |
| OAuth identity, access/refresh tokens, scopes, connected-account identifiers | Connect Google/Gmail/YouTube/Instagram and other social services | Supabase Edge Functions and database; token encryption helper `supabase/functions/_shared/social-token-crypto.ts`; social and Gmail auth functions | Yes, sometimes workspace-scoped | Disconnect flows exist in some integrations; complete provider revocation and deletion coverage are unverified. Never disclose token values. |
| Email drafts, recipient/contact details, sent message IDs and replies | Run user-approved outreach campaigns | Gmail API, Supabase Postgres, Edge Functions `gmail-auth`, `email-outreach`, `email-worker` | Yes; company duties can be shared | Sends require approval in code tests; provider retention and deletion/recipient rights require review. |
| Call metadata, reports, recordings/transcripts where enabled | User-directed call workflows and result tracking | Supabase Postgres/Storage and configured telephony/voice providers; `src/lib/telephony.ts`, `src/lib/calls.ts`, call Edge Functions | Yes; some data may relate to third parties | Recording consent, notice, jurisdictional rules, retention, and provider cleanup require legal and operational verification. |
| Diagnostic/usage events | Product operation, usage and admin reporting | Supabase tables/triggers and app code (`src/lib/analytics-events.ts`) | Yes or pseudonymous depending on event | Exact event payloads, retention period, and App Privacy classification require catalog-level review. |
| Payment/card data | Paid subscriptions | No payment SDK or implemented purchase flow found; upgrade screen says paid upgrades are unavailable | N/A currently | Mark not collected by current implementation; reassess if purchases are introduced. |

### App Privacy disclosure work items

Do not submit privacy labels from this draft alone. For each relevant Apple category, verify collection by Synq and every embedded SDK/provider, purpose, linkage to identity, tracking use, optionality, and retention. Areas requiring owner/provider confirmation include Contact Info (email/name/phone), User Content (messages, files, media, call recordings), Identifiers (account and connected-account IDs), Usage Data, Diagnostics, and third-party AI/communications processing. No tracking SDK was confirmed by this repository scan; confirm the final native dependency graph before answering App Store Connect's tracking questions.

## Privacy policy draft (publication blocked)

### Who operates Synq

Synq is operated by **[LEGAL ENTITY / OWNER NAME — confirm]** (“Synq,” “we,” or “us”). Contact: **[PRIVACY CONTACT EMAIL — confirm]**. Mailing address and applicable jurisdiction: **[CONFIRM IF REQUIRED]**.

### Information we process

Synq processes account and profile information, workspace membership, business contacts and lead records, user prompts and AI-generated responses, files and generated media, integration identifiers and authorization tokens, campaign drafts and replies, and call-related metadata or recordings when a user enables those features. The exact fields depend on the features and integrations a user chooses to connect.

### How information is used

Information is used to authenticate users, provide workspace and sales tools, respond to user prompts, generate or store media, connect user-authorized third-party accounts, carry out user-approved communications, secure the service, and operate usage limits. Synq must confirm the final purposes and optional/required classification before publication.

### Service providers and transfers

Synq uses Supabase for authentication, database, file storage, and server-side functions. The codebase also integrates with Google/Gmail/YouTube, social platforms, AI/media providers (including Gemini, Pollinations, and fal.ai), and call/voice services where enabled. The production provider list, subprocessors, processing locations, and each provider's retention/training practices must be confirmed before this policy is published. OAuth access is requested for the provider features a user chooses to connect.

### Sharing and communications

Workspace records may be shared with approved members according to workspace roles. Connected services receive data necessary for the action a user explicitly initiates, such as a user-approved email, call, media generation, or social post. Synq must verify that actual product controls and all provider destinations match this description.

### Retention and deletion

Synq's exact retention schedule is **[OWNER MUST DEFINE, INCLUDING BACKUPS, CALL RECORDINGS, PROVIDER RETENTION, AND LEGAL RETENTION]**. At the time of this draft, an in-app account deletion workflow and end-to-end data cleanup are not verified. Do not publish a promise that users can delete all data until authenticated deletion, workspace ownership resolution, uploaded-file cleanup, provider revocation, retries, and backup/legally required exceptions have been implemented and tested.

### Security

Synq uses authentication, role checks, database row-level security, and server-side storage of privileged provider credentials. The actual production control set, security-advisor findings, incident-response process, encryption, and backup practices require owner/security review; do not claim a certification or guarantee.

### Children and age limits

**[OWNER/COUNSEL MUST DEFINE AGE ELIGIBILITY AND CHILDREN'S DATA PRACTICES.]** Do not select an age rating or publish a children-related claim from this placeholder.

### Changes and contact

Policy URL: **[PUBLIC HTTPS URL — publish and verify before submission]**. Privacy requests: **[PRIVACY CONTACT EMAIL]**. Effective date: **[DATE AFTER APPROVAL]**.

## Owner confirmations required before publication

1. Legal operator name, jurisdiction/address where required, privacy/support contacts, and effective date.
2. Retention schedules for every listed category, backups, deleted accounts, call recordings/transcripts, and provider copies.
3. Production providers/subprocessors, data regions, AI model retention/training settings, and transfer safeguards.
4. Whether workspace-shared customer data remains after a member leaves/deletes and the lawful basis/notice for each use.
5. Age eligibility, call recording/automated communications notice and consent, and any required legal disclosures.
6. Public HTTPS policy and support URLs; validate they work without authentication.
7. Final Apple privacy-manifest, SDK, and App Privacy label review from the signed archive/dependency inventory.
