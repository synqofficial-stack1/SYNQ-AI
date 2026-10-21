// Provider-free tests. No database writes or paid API calls.
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript');
const exportsForTest = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      require('node:path').join(__dirname, '../src/lib/sales-workspace.ts'),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  {
    exports: exportsForTest,
    require: () => ({ supabase: {} }),
    Date,
    Intl,
    Number,
    Error,
    console,
  },
);
const api = exportsForTest;
test('email replies prefill a reviewable opportunity without inventing a price or contacting anyone', () => {
  const input = api.opportunityFromEmail(
    {
      email: 'alex@example.invalid',
      name: 'Alex',
      analysis: {
        intent: 'interested',
        summary: 'Asked for a proposal',
        next_step: 'Prepare a proposal',
        opted_out: false,
      },
    },
    { title: 'Feedback', subject: 'A question' },
  );
  assert.equal(input.stage, 'interested');
  assert.equal(input.amount, null);
  assert.equal(input.contact_email, 'alex@example.invalid');
  assert.match(input.notes, /Asked for a proposal/);
  assert.throws(() =>
    api.opportunityFromEmail(
      { analysis: { opted_out: true } },
      { title: 'Test' },
    ),
  );
});
const deal = (patch = {}) => ({
  ...api.blankDeal(),
  id: 'id',
  user_id: 'owner',
  organization_id: 'org',
  created_at: '2026-10-21T10:00:00Z',
  updated_at: '2026-10-21T10:00:00Z',
  closed_at: null,
  title: 'Opportunity',
  ...patch,
});
test('pipeline excludes closed/archived deals and tracks unknown values without inventing estimates', () => {
  const s = api.salesSummary(
    [
      deal({ amount: 100 }),
      deal({ amount: null }),
      deal({ stage: 'won', amount: 900, closed_at: '2026-10-21T10:00:00Z' }),
      deal({ archived: true, amount: 500 }),
      deal({ stage: 'lost', amount: 200, lost_reason: 'Timing' }),
    ],
    '2026-10-21',
  );
  assert.equal(s.pipeline, 100);
  assert.equal(s.open.length, 2);
  assert.equal(s.unknownValue, 1);
  assert.equal(s.wonValue, 900);
});
test('monthly wins use closing date and preserve archived wins; reopened and previous-month deals do not count', () => {
  const s = api.salesSummary(
    [
      deal({
        stage: 'won',
        archived: true,
        amount: 100,
        closed_at: '2026-10-21T10:00:00Z',
      }),
      deal({ stage: 'won', amount: 500, closed_at: '2026-09-20T10:00:00Z' }),
      deal({ stage: 'negotiating', amount: 200, closed_at: null }),
    ],
    '2026-10-21',
  );
  assert.equal(s.wonValue, 100);
  assert.equal(s.won.length, 1);
});
test('due actions include today and overdue open deals, ordered by date', () => {
  const s = api.salesSummary(
    [
      deal({ id: 'later', next_action: 'Send', next_action_on: '2026-10-22' }),
      deal({ id: 'today', next_action: 'Reply', next_action_on: '2026-10-21' }),
      deal({
        id: 'overdue',
        next_action: 'Revise',
        next_action_on: '2026-10-20',
      }),
      deal({ stage: 'won', next_action: 'Old', next_action_on: '2026-10-19' }),
    ],
    '2026-10-21',
  );
  assert.deepEqual(
    Array.from(s.due, (d) => d.id),
    ['overdue', 'today'],
  );
});
test('invalid dates, negative values, lost deals without reasons and malformed meetings are rejected', () => {
  assert.equal(api.validDate('2026-02-30'), false);
  assert.equal(api.validDate('2024-02-29'), true);
  assert.equal(api.validDate('2026-02-29'), false);
  for (const patch of [
    { title: '' },
    { amount: -1 },
    { amount: NaN },
    { contact_email: 'bad-email' },
    { stage: 'lost', lost_reason: '' },
    { expected_close: '2026-13-01' },
    { next_action_on: '2026-10-21', next_action: '' },
    { meeting_on: '2026-10-22', meeting_time: '25:30' },
    { meeting_time: '14:30' },
  ])
    assert.throws(() =>
      api.validateDeal({ ...api.blankDeal(), title: 'Valid', ...patch }),
    );
  assert.doesNotThrow(() =>
    api.validateDeal({
      ...api.blankDeal(),
      title: 'Valid',
      stage: 'lost',
      lost_reason: 'Budget',
      meeting_on: '2026-10-22',
      meeting_time: '14:30',
    }),
  );
});
test('quotation templates mark unknown prices and leave tax and terms for human review', () => {
  const text = api.quoteDraft({ ...api.blankDeal(), title: 'Website project' });
  assert.match(text, /DRAFT QUOTATION/);
  assert.match(text, /\[Enter amount\]/);
  assert.match(text, /Taxes.*Specify/);
  assert.match(text, /Payment terms.*Enter/);
  assert.match(
    api.quoteDraft({ ...api.blankDeal(), title: 'Package', amount: 1500 }),
    /1,500/,
  );
});
test('CSV protects spreadsheet formulas and correctly escapes commas, quotes and newlines', () => {
  const csv = api.dealsCsv([
    deal({
      title: '=IMPORTXML("evil")',
      contact_name: 'Alex, Sam',
      notes: 'Line\nTwo',
    }),
  ]);
  assert.ok(csv.includes('"\'=IMPORTXML(""evil"")"'));
  assert.ok(csv.includes('"Alex, Sam"'));
  assert.ok(csv.includes('Value (INR)'));
});
