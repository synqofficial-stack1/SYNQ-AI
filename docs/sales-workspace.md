# Sales workspace

Sales now opens a company pipeline, with separate tabs for Next actions, Meetings,
Quotations, Targets, and the existing Email duties. The email composer stays on
the Email duty button beside AI mode. Marketing, campaign comparison, and market
trends are outside this change.

## Workflow

- Add a deal or copy a CRM contact into a new opportunity. The copied contact
  fields remain editable and do not change the original CRM record.
- Track New, Contacted, Interested, Negotiating, Won, and Lost stages. Deal value
  is optional and all recorded values are INR. Unknown values are excluded from
  monetary totals and counted explicitly.
- Set a next action and optional due date; the Next actions tab organizes open
  deals by due date. Clearing a completed action removes that reminder.
- Record a meeting date, local wall-clock time, outcome, and notes. This is a
  tracker, not calendar invitation delivery or an automatic reminder service.
- Prepare an editable quotation template, save it against the deal, and copy or
  download it as plain text. Scope, taxes, validity, and payment terms are human
  inputs. No quotation is sent automatically and no AI generation is required.
- Require a reason for lost deals. The Targets tab groups recorded loss reasons.
- The owner sets the current month's company revenue/deal target. Progress uses
  recorded wins closed this month, including archived wins. It is not an invoice
  or payment report. Reopening a deal clears its closing timestamp.
- Archive/restore deals without deleting their history. Export the filtered
  pipeline to CSV with spreadsheet-formula escaping.
- A recipient's Email duties detail can prefill a Sales opportunity for review.
  No value is invented; opted-out contacts cannot use this shortcut.

## Access and persistence

`20261021100000_sales_workspace.sql` adds `sales_deals` and `sales_targets` after
the company-workspaces migration. Both use company membership RLS. Pending,
removed, and other-company users cannot read or modify these records. Teammates
can edit shared deals, while only the company owner can change targets.
Authorship/organization columns are immutable to clients. Server triggers keep
closing/edit timestamps honest, and updates check the version timestamp so one
teammate cannot silently overwrite another's newer edit.

The UI loads up to 2,000 deals and reports an explicit limit rather than showing
truncated totals if that is exceeded. Data refreshes every 30 seconds. All dates
and displayed month calculations use the browser's local calendar; meeting times
are entered as wall-clock values, without cross-time-zone conversion.

## Verification

- `npm run test:sales`: pipeline/win totals, due dates, calendar and input checks,
  quotation placeholders, CSV escaping, and email-to-opportunity prefilling.
- `supabase/tests/sales_workspace.sql`: rollback-only integration checks for
  company isolation, shared editing, owner targets, stale edits, closed dates,
  required loss reasons, and membership removal.
- TypeScript, scoped lint, Expo web export, desktop/mobile static layout checks,
  and an interactive in-memory create/edit/action/meeting/quote/target flow.
- No live provider requests or messages are needed to verify these features.
- Remaining acceptance: exercise persistence in the signed-in local app with
  owner/teammate accounts. Gmail delivery remains a separate pilot test.
