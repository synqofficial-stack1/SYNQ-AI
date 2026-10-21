/* global __dirname, Buffer */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '..');

function load(relative, stubs = {}) {
  const cache = new Map();
  function moduleAt(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    vm.runInNewContext(
      code,
      {
        exports,
        require: (name) =>
          stubs[name] || moduleAt(path.resolve(path.dirname(file), name)),
        TextEncoder,
        TextDecoder,
        atob,
        btoa,
        Response,
        Request,
        AbortSignal,
        crypto: globalThis.crypto,
        console,
        setTimeout,
        URL,
        Date,
        ...stubs.__globals,
      },
      { filename: file },
    );
    return exports;
  }
  return moduleAt(path.join(root, relative));
}
const core = load('supabase/functions/_shared/outreach-core.ts');
const analysis = {
  summary: 'Interested, but wants pricing.',
  sentiment: 'positive',
  intent: 'needs_information',
  answers: [{ question: 'Budget?', answer: null }],
  themes: ['pricing'],
  next_step: 'Share the confirmed pricing.',
  opted_out: false,
};

test('bulk recipients are normalized and deduplicated; names stay optional', () => {
  const rows = core.namedRecipients([
    { email: 'Alex@Gmail.com', name: 'Alex' },
    { email: 'alex@gmail.com', name: 'Duplicate' },
    { email: 'sam@example.com', name: '' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].email, 'alex@gmail.com');
  assert.equal(rows[0].name, 'Alex');
  assert.throws(() =>
    core.namedRecipients([{ email: 'a@b.com\r\nBcc: victim@b.com', name: '' }]),
  );
  assert.throws(() =>
    core.namedRecipients(
      Array.from({ length: 51 }, (_, i) => ({
        email: `a${i}@b.com`,
        name: '',
      })),
    ),
  );
});
test('MIME encoding supports Unicode and sends exactly one To without CC or BCC', () => {
  const raw = core.mimeMessage(
    'me@example.com',
    'alex@gmail.com',
    'नमस्ते Alex',
    'Hello Zoë,\nHow are you?',
    '<abc-123@synq.local>',
  );
  const decoded = core.decode64(raw);
  assert.match(decoded, /To: alex@gmail.com\r\n/);
  assert.doesNotMatch(decoded, /\r\n(?:Cc|Bcc):/i);
  assert.match(decoded, /Content-Transfer-Encoding: base64/);
  assert.match(
    Buffer.from(
      decoded.split('\r\n\r\n')[1].replace(/\r\n/g, ''),
      'base64',
    ).toString(),
    /Hello Zoë/,
  );
  assert.throws(() =>
    core.mimeMessage(
      'me@example.com',
      'a@b.com',
      'hello\r\nBcc: x@y.com',
      'body',
      '<abc@synq.local>',
    ),
  );
  assert.equal(core.personalizedBody('Hi {{name}},', ''), 'Hi there,');
});
test('multipart replies prefer plain text and quoted questions are excluded from analysis', () => {
  const encode = (s) => Buffer.from(s).toString('base64url');
  const part = {
    mimeType: 'multipart/alternative',
    parts: [
      {
        mimeType: 'text/html',
        body: { data: encode('<p>HTML alternative</p>') },
      },
      {
        mimeType: 'text/plain',
        body: {
          data: encode(
            'Interested.\n\nOn Monday, Alex wrote:\nWhat is your budget?',
          ),
        },
      },
    ],
  };
  assert.match(core.messageText(part), /^Interested/);
  assert.equal(core.originalReply(core.messageText(part)), 'Interested.');
  assert.equal(
    core.emailAddress('Alex Smith <ALEX@gmail.com>'),
    'alex@gmail.com',
  );
});
test('analysis preserves null answers, rejects invalid schema and uses server question labels', () => {
  const result = core.validateAnalysis(analysis, ['What is your budget?']);
  assert.equal(result.answers[0].question, 'What is your budget?');
  assert.equal(result.answers[0].answer, null);
  assert.throws(() =>
    core.validateAnalysis({ ...analysis, answers: [] }, ['Budget?']),
  );
  assert.throws(() =>
    core.validateAnalysis({ ...analysis, sentiment: 'excellent' }, ['Budget?']),
  );
  assert.equal(core.questionsFrom([], true).length, 0);
});
test('stats count respondents separately from messages and exclude unsent people from response rate', () => {
  const rows = [
    { email: 'a@b.com', status: 'replied', sent_at: 'now', analysis },
    { email: 'b@b.com', status: 'sent', sent_at: 'now', analysis: null },
    { email: 'c@b.com', status: 'queued', sent_at: null, analysis: null },
    { email: 'd@b.com', status: 'failed', sent_at: null, analysis: null },
  ];
  const stats = core.campaignStats(rows, 3);
  assert.equal(stats.sent, 2);
  assert.equal(stats.replied, 1);
  assert.equal(stats.received, 3);
  assert.equal(stats.response_rate, 50);
  assert.equal(stats.waiting, 1);
  assert.equal(stats.failed, 1);
});

function workerHarness(options = {}) {
  const campaign = {
    id: 'campaign',
    user_id: 'owner',
    organization_id: options.company ? 'company' : null,
    title: 'Research',
    goal: 'Learn needs',
    questions: ['Budget?'],
    subject: 'A question',
    body: 'Hello {{name}},\nBudget?',
    status: 'active',
    sender_email: 'sender@gmail.com',
    report: null,
  };
  const recipient = {
    id: 'person',
    campaign_id: 'campaign',
    email: 'person@gmail.com',
    name: 'Sam',
    status: options.status || 'queued',
    sent_at: options.status ? '2026-10-20T09:00:00Z' : null,
    outbound_message_id: options.status ? '<person@synq.local>' : null,
    thread_id: options.status === 'sent' ? 'thread' : null,
    gmail_message_id: options.status === 'sent' ? 'outbound' : null,
    analysis: null,
    analysis_message_count: 0,
  };
  const tables = {
    organization_members: options.removed
      ? []
      : [{ user_id: 'owner', organization_id: 'company', status: 'active' }],
    outreach_campaigns: [campaign],
    outreach_recipients: [recipient],
    outreach_messages: [],
    outreach_suppressions: options.suppressed
      ? [{ user_id: 'owner', email: recipient.email }]
      : [],
  };
  let sends = 0,
    analyzes = 0;
  const db = {
    rpc: async () => ({ data: !options.locked }),
    from: (table) => {
      let mode = 'read',
        values,
        settings,
        filters = [],
        limit = Infinity,
        single = false;
      const query = {
        select: (_columns, opts) => {
          settings = opts;
          return query;
        },
        eq: (k, v) => {
          filters.push((r) => r[k] === v);
          return query;
        },
        in: (k, values) => {
          filters.push((r) => values.includes(r[k]));
          return query;
        },
        order: () => query,
        limit: (n) => {
          limit = n;
          return query;
        },
        update: (row) => {
          mode = 'update';
          values = row;
          return query;
        },
        upsert: (row) => {
          mode = 'upsert';
          values = row;
          return query;
        },
        single: () => {
          single = true;
          return query;
        },
        maybeSingle: () => {
          single = true;
          return query;
        },
        then: (resolve) => {
          let rows = tables[table]
            .filter((r) => filters.every((f) => f(r)))
            .slice(0, limit);
          if (mode === 'update') rows.forEach((r) => Object.assign(r, values));
          if (mode === 'upsert') {
            const existing = tables[table].find((r) =>
              table === 'outreach_messages'
                ? r.recipient_id === values.recipient_id &&
                  r.gmail_message_id === values.gmail_message_id
                : r.email === values.email,
            );
            rows = existing
              ? []
              : [{ id: `row-${tables[table].length}`, ...values }];
            if (!existing) tables[table].push(...rows);
          }
          return Promise.resolve({
            data: single ? rows[0] || null : rows,
            count: settings?.count ? rows.length : undefined,
            error: null,
          }).then(resolve);
        },
      };
      return query;
    },
  };
  class GmailError extends Error {
    constructor(status) {
      super('Gmail error');
      this.status = status;
    }
  }
  const gmail = async (_token, url) => {
    if (url === 'messages/send') {
      sends++;
      if (options.networkFailure) throw new Error('timeout');
      if (options.rejected) throw new GmailError(403);
      return { id: 'outbound', threadId: 'thread' };
    }
    if (url.startsWith('messages?q='))
      return {
        messages: options.reconciled
          ? [{ id: 'outbound', threadId: 'thread' }]
          : [],
      };
    return {
      messages: options.reply
        ? [
            {
              id: 'reply',
              internalDate: String(Date.now()),
              payload: {
                mimeType: 'text/plain',
                headers: [
                  {
                    name: 'From',
                    value: options.impostor
                      ? 'other@gmail.com'
                      : 'Sam <person@gmail.com>',
                  },
                  ...(options.auto
                    ? [{ name: 'Auto-Submitted', value: 'auto-replied' }]
                    : []),
                ],
                body: {
                  data: Buffer.from(
                    'Interested. Please share pricing.',
                  ).toString('base64url'),
                },
              },
            },
          ]
        : [],
    };
  };
  const worker = load('supabase/functions/_shared/outreach-worker.ts', {
    './outreach-gmail.ts': {
      GmailError,
      gmail,
      mailboxAccess: async () => ({
        token: 'server-only',
        email: 'sender@gmail.com',
      }),
    },
    './outreach-ai.ts': {
      analyzeReplies: async () => {
        analyzes++;
        return { ...analysis, opted_out: !!options.optedOut };
      },
    },
  });
  return {
    campaign,
    recipient,
    tables,
    run: () => worker.processCampaign(db, campaign),
    sends: () => sends,
    analyzes: () => analyzes,
  };
}
test('worker sends separate approved email, records Gmail IDs, then stores and summarizes a genuine reply', async () => {
  const h = workerHarness({ reply: true });
  await h.run();
  assert.equal(h.sends(), 1);
  assert.equal(h.recipient.status, 'replied');
  assert.equal(h.analyzes(), 1);
  assert.equal(h.tables.outreach_messages.length, 1);
  assert.equal(h.campaign.status, 'completed');
  assert.equal(h.campaign.report.replied, 1);
  await h.run();
  assert.equal(h.sends(), 1);
  assert.equal(h.analyzes(), 1);
  assert.equal(h.tables.outreach_messages.length, 1);
});
test('uncertain sends are never retried and a recovered Sent message restores tracking', async () => {
  const h = workerHarness({ networkFailure: true });
  await h.run();
  assert.equal(h.recipient.status, 'uncertain');
  await h.run();
  assert.equal(h.sends(), 1);
  const recovered = workerHarness({ status: 'uncertain', reconciled: true });
  await recovered.run();
  assert.equal(recovered.sends(), 0);
  assert.equal(recovered.recipient.status, 'sent');
});
test('a held campaign lease prevents duplicate send work', async () => {
  const h = workerHarness({ locked: true });
  assert.equal((await h.run()).busy, true);
  assert.equal(h.sends(), 0);
});
test('known opt-outs are suppressed and Gmail rejects remain failed rather than counted as sent', async () => {
  const suppressed = workerHarness({ suppressed: true });
  await suppressed.run();
  assert.equal(suppressed.sends(), 0);
  assert.equal(suppressed.recipient.status, 'failed');
  const rejected = workerHarness({ rejected: true });
  await rejected.run();
  assert.equal(rejected.recipient.status, 'failed');
  assert.equal(rejected.recipient.sent_at, null);
});
test('automatic replies and messages from a different sender never become customer answers', async () => {
  for (const config of [{ auto: true }, { impostor: true }]) {
    const h = workerHarness({ status: 'sent', reply: true, ...config });
    await h.run();
    assert.equal(h.recipient.status, 'sent');
    assert.equal(h.analyzes(), 0);
  }
});
test('an analyzed opt-out is stored for suppression on future campaigns', async () => {
  const h = workerHarness({ reply: true, optedOut: true });
  await h.run();
  assert.equal(h.tables.outreach_suppressions.length, 1);
});

function endpointHarness(options = {}) {
  let handler,
    writes = 0,
    rpcArgs;
  const db = {
    auth: {
      getUser: async () => ({
        data: { user: options.signedOut ? null : { id: 'owner' } },
        error: null,
      }),
    },
    rpc: async (_name, args) => {
      rpcArgs = args;
      return { data: 'new-campaign', error: null };
    },
    from: () => {
      let owner = 'owner';
      const q = {
        select: () => q,
        eq: (key, value) => {
          if (key === 'user_id') owner = value;
          return q;
        },
        update: () => {
          writes++;
          return q;
        },
        maybeSingle: async () => ({
          data:
            options.otherOwner || owner !== 'owner'
              ? null
              : {
                  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                  user_id: options.teammate ? 'teammate' : 'owner',
                  status: options.status || 'draft',
                },
          error: null,
        }),
        then: (resolve) =>
          Promise.resolve({ data: [{ id: 'campaign' }], error: null }).then(
            resolve,
          ),
      };
      return q;
    },
  };
  load('supabase/functions/email-outreach/index.ts', {
    'jsr:@supabase/supabase-js@2': { createClient: () => db },
    '../_shared/outreach-ai.ts': {},
    '../_shared/outreach-gmail.ts': {
      mailboxAccess: async () => ({ email: 'sender@gmail.com' }),
    },
    '../_shared/outreach-worker.ts': {
      buildReport: async () => ({ replied: 1 }),
    },
    __globals: {
      Deno: {
        env: { get: () => 'test' },
        serve: (fn) => {
          handler = fn;
        },
      },
    },
  });
  return {
    writes: () => writes,
    rpcArgs: () => rpcArgs,
    run: (body) =>
      handler(
        new Request('https://test.invalid', {
          method: 'POST',
          headers: { Authorization: 'Bearer signed-user' },
          body: JSON.stringify(body),
        }),
      ),
  };
}
test('sending requires explicit confirmation, draft ownership, and a valid signed-in user', async () => {
  const body = {
    action: 'send',
    campaign_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  };
  for (const options of [
    {},
    { signedOut: true },
    { otherOwner: true },
    { status: 'active' },
  ]) {
    const h = endpointHarness(options);
    const response = await h.run({
      ...body,
      confirmed: options.status === 'active' || options.otherOwner,
    });
    assert.notEqual(response.status, 200);
    assert.equal(h.writes(), 0);
  }
});
test('saving a draft uses the authenticated owner and never honors a client-supplied send status', async () => {
  const h = endpointHarness();
  const response = await h.run({
    action: 'create',
    user_id: 'someone-else',
    status: 'active',
    title: 'Feedback',
    goal: 'Learn what people need',
    questions: [],
    subject: 'A question',
    body: 'Hello {{name}},',
    recipients: [{ email: 'alex@gmail.com' }],
  });
  assert.equal(response.status, 200);
  assert.equal(h.rpcArgs().p_user, 'owner');
  assert.equal(h.rpcArgs().p_recipients[0].name, '');
  assert.equal(h.writes(), 0);
});
test('background checker rejects an invalid worker key before accessing campaigns', async () => {
  let handler;
  load('supabase/functions/email-worker/index.ts', {
    'jsr:@supabase/supabase-js@2': {
      createClient: () => {
        throw new Error('Unauthorized DB access');
      },
    },
    '../_shared/outreach-worker.ts': {},
    __globals: {
      Deno: {
        env: { get: () => 'expected-private-key' },
        serve: (fn) => {
          handler = fn;
        },
      },
    },
  });
  const response = await handler(
    new Request('https://test.invalid', {
      method: 'POST',
      headers: { 'x-outreach-worker': 'wrong-key' },
    }),
  );
  assert.equal(response.status, 401);
});

test('approved teammates can generate reports but cannot send, pause, or sync another sender’s Gmail', async () => {
  const h = endpointHarness({ teammate: true });
  for (const action of ['send', 'pause', 'sync']) {
    const response = await h.run({
      action,
      campaign_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      confirmed: true,
    });
    assert.equal(response.status, 403);
  }
  const response = await h.run({
    action: 'report',
    campaign_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  });
  assert.equal(response.status, 200);
  assert.equal(h.writes(), 0);
});

test('removed company senders are paused before Gmail is called', async () => {
  const h = workerHarness({ company: true, removed: true });
  assert.equal((await h.run()).paused, true);
  assert.equal(h.campaign.status, 'paused');
  assert.equal(h.sends(), 0);
  assert.equal(h.analyzes(), 0);
});
