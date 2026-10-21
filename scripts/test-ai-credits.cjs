// Local Edge Function tests: provider and database boundaries are mocked; no real quota is spent.
/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness(endpoint, options = {}) {
  let handler;
  let providerCalls = 0;
  const rpcCalls = [], writes = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: options.unsigned ? null : { id: 'owner' } } }) },
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (options.usageFailure) return { error: { message: 'missing migration' } };
      if (name === 'refund_ai_credits') return { error: options.refundRetry && rpcCalls.filter(c => c.name === name).length === 1 ? {} : null };
      return { data: { allowed: !options.exhausted, debit_id: options.exhausted ? null : 'receipt', limit: 50, used: options.exhausted ? 50 : 50, remaining: 0, needed: 1, resets_at: '2026-10-14T00:00:00Z' } };
    },
    from: table => {
      let data = table === 'departments' ? { id: 'dept', system_instructions: 'Help the customer' } : table === 'messages' ? [] : { id: 'record' };
      let error = null;
      const chain = {
        select: () => chain, eq: () => chain, order: () => chain,
        limit: async () => ({ data, error }),
        maybeSingle: async () => ({ data, error }), single: async () => ({ data, error }),
        insert: row => { writes.push({ table, row }); data = { id: 'record' }; if (options.saveFailure && row.role === 'model') error = { message: 'failed' }; return chain; },
        update: () => chain,
        then: resolve => Promise.resolve({ data, error }).then(resolve),
      };
      return chain;
    },
  };
  const cache = new Map();
  const load = file => {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, {
      exports, Response, Request, Error, console, AbortSignal,
      require: name => name.startsWith('jsr:') ? { createClient: () => db } : load(path.resolve(path.dirname(file), name)),
      Deno: { env: { get: () => 'test-value' }, serve: fn => { handler = fn; } },
      fetch: async () => {
        providerCalls++;
        if (options.providerThrows) throw new Error('offline');
        return Response.json({ candidates: [{ content: { parts: options.empty ? [] : [{ text: 'A useful answer' }] } }] });
      },
    });
    return exports;
  };
  load(path.join(__dirname, `../supabase/functions/${endpoint}/index.ts`));
  return { rpcCalls, writes, providerCalls: () => providerCalls, run: body => handler(new Request('https://test.invalid', { method: 'POST', headers: { Authorization: 'Bearer test-user' }, body: JSON.stringify(body) })) };
}

const chat = { kind: 'sales_ai', message: 'Draft an email', context: { ai_mode: true } };

test('every chat entry point spends one credit under the verified user, including PDF analysis', async () => {
  for (const kind of ['assistant', 'sales_ai', 'crm', 'content', 'campaign']) {
    const h = harness('chat');
    const result = await h.run({ ...chat, kind, cost: 0, user_id: 'other-user', attachments: [{ name: 'brief.pdf', data_url: 'data:application/pdf;base64,JVBERg==' }] });
    assert.equal(result.status, 200);
    assert.equal(h.providerCalls(), 1);
    assert.deepEqual(JSON.parse(JSON.stringify(h.rpcCalls)), [{ name: 'reserve_ai_credits', args: { p_user_id: 'owner', p_operation: 'chat' } }]);
  }
});

test('exhausted chat requests return upgrade details before provider calls or message writes', async () => {
  const h = harness('chat', { exhausted: true });
  const result = await h.run(chat);
  assert.equal(result.status, 402);
  const body = await result.json();
  assert.equal(body.code, 'AI_CREDIT_LIMIT');
  assert.equal(body.upgrade_url, '/upgrade');
  assert.equal(body.resets_at, '2026-10-14T00:00:00Z');
  assert.equal(h.providerCalls(), 0);
  assert.equal(h.writes.length, 0);
});

test('provider errors, empty chat output and failed persistence refund the reservation', async () => {
  for (const options of [{ providerThrows: true }, { empty: true }, { saveFailure: true }]) {
    const h = harness('chat', options);
    assert.ok((await h.run(chat)).status >= 400);
    assert.equal(h.rpcCalls.at(-1).name, 'refund_ai_credits');
    assert.equal(h.rpcCalls.at(-1).args.p_debit_id, 'receipt');
  }
});

test('refund RPC gets one retry after transient failure', async () => {
  const h = harness('chat', { empty: true, refundRetry: true });
  await h.run(chat);
  assert.equal(h.rpcCalls.filter(c => c.name === 'refund_ai_credits').length, 2);
});

test('usage outages fail closed; auth, validation and capability checks do not spend credits', async () => {
  const missing = harness('chat', { usageFailure: true });
  assert.equal((await missing.run(chat)).status, 503);
  assert.equal(missing.providerCalls(), 0);
  for (const [options, body, status] of [[{ unsigned: true }, chat, 401], [{}, { ...chat, message: '' }, 400], [{}, { action: 'ai-mode-capabilities' }, 200]]) {
    const h = harness('chat', options);
    assert.equal((await h.run(body)).status, status);
    assert.equal(h.rpcCalls.length, 0);
    assert.equal(h.providerCalls(), 0);
  }
});

test('legacy task endpoint uses the same chat credit gate so it cannot bypass the daily limit', async () => {
  for (const exhausted of [false, true]) {
    const h = harness('run-task', { exhausted });
    const response = await h.run({ task_type: 'draft_content', notes: 'Draft a product description' });
    assert.equal(response.status, exhausted ? 402 : 200);
    assert.equal(h.providerCalls(), exhausted ? 0 : 1);
    assert.equal(h.rpcCalls[0].args.p_operation, 'chat');
  }
});

test('browser bridge preserves remaining credits and upgrade errors for both chat and images', async () => {
  const cache = new Map();
  const usage = { limit: 50, used: 49, remaining: 1, resets_at: '2026-10-14T00:00:00Z', chat_cost: 1, image_cost: 2 };
  const limit = { ...usage, needed: 2, code: 'AI_CREDIT_LIMIT', error: 'An image needs 2 credits. Upgrade for more.' };
  const calls = [];
  const supabase = {
    rpc: async (...args) => { calls.push(args); return { data: usage }; },
    functions: { invoke: async () => ({ error: { context: Response.json(limit, { status: 402 }) } }) },
  };
  const load = name => {
    if (name === '@/lib/supabase') return { supabase };
    if (name === '@/lib/chat') return { loadMessages: async () => [] };
    const file = name.startsWith('@/') ? path.join(__dirname, '../src', name.slice(2) + '.ts') : name;
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require: load, Response, Error, localStorage: { getItem: () => null, setItem: () => {} } });
    return exports;
  };
  const bridge = load(path.join(__dirname, '../src/features/ai-mode/bridge.ts')).createBridge('owner');
  const balance = await (await bridge('/api/usage?clientId=someone-else')).json();
  assert.equal(balance.remaining, 1);
  assert.deepEqual(calls, [['get_ai_usage']]);
  for (const route of ['/api/image', '/api/chat']) {
    const response = await bridge(route, { body: JSON.stringify({ prompt: 'An image', dept: 'sales', chatId: 'chat-id', messages: [{ role: 'user', content: 'hello' }] }) });
    assert.equal(response.status, 402);
    assert.equal((await response.json()).remaining, 1);
  }
});
