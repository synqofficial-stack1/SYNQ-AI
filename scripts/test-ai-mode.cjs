// Mock external boundaries so tests never spend quota or write to Supabase.
/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const { Buffer } = require('node:buffer');

function harness(options = {}) {
  let handler;
  const writes = [], uploads = [], removals = [], requests = [], creditCalls = [];
  const db = {
    rpc: async (name, args) => {
      creditCalls.push({ name, args });
      if (options.usageError) return { error: new Error('usage unavailable') };
      return { data: name === 'reserve_ai_credits' ? { allowed: !options.noCredits, debit_id: options.noCredits ? undefined : 'debit-id', limit: 50, used: options.noCredits ? 49 : 2, remaining: options.noCredits ? 1 : 48, needed: 2, resets_at: '2026-10-14T00:00:00Z' } : null, error: null };
    },
    auth: { getUser: async () => ({ data: { user: options.invalidAuth ? null : { id: 'owner-id' } } }) },
    from: () => ({
      select: () => ({ limit: async () => ({ error: options.schemaError ? new Error('missing table') : null }) }),
      insert: (row) => { writes.push(row); return { select: () => ({ single: async () => ({ data: row, error: options.saveError ? new Error('DB failed') : null }) }) }; },
    }),
    storage: { from: () => ({ upload: async (name, bytes, config) => { uploads.push({ name, bytes, config }); return { error: options.uploadError ? new Error('failed') : null }; }, remove: async (names) => { removals.push(...names); return { error: null }; } }) },
  };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../supabase/functions/generate-image/index.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = {
    exports: {}, require: () => ({ createClient: () => db }), Request, Response, AbortSignal, Error, DOMException, console,
    Uint8Array, atob, crypto: webcrypto,
    Deno: { serve: (fn) => { handler = fn; }, env: { get: (key) => key === 'POLLINATIONS_IMAGE_MODEL' ? options.model : options.missingKey && key === 'POLLINATIONS_API_KEY' ? undefined : 'test-only' } },
    fetch: async (url, input) => {
      requests.push({ url, input });
      if (options.timeout) throw new DOMException('timed out', 'TimeoutError');
      return options.providerStatus ? new Response('{"error":"provider details test-only"}', { status: options.providerStatus })
        : Response.json(options.noImage ? { data: [] } : { data: [{ b64_json: options.imageData ?? 'iVBORw0KGgo=' }] });
    },
  };
  const creditExports = {};
  const creditCode = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../supabase/functions/_shared/ai-credits.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(creditCode, { ...context, exports: creditExports });
  context.require = name => name.endsWith('/ai-credits.ts') ? creditExports : { createClient: () => db };
  vm.runInNewContext(code, context);
  return { writes, uploads, removals, requests, creditCalls, run: (body = {}, authorized = true) => handler(new Request('https://local.test', { method: 'POST', headers: authorized ? { Authorization: 'Bearer test-only' } : {}, body: JSON.stringify(body) })) };
}
const valid = { prompt: 'A gold product launch poster', department: 'sales', aspect_ratio: '1:1' };

function posterPrompt() {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/ai-mode/Poster.jsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    fileName: 'Poster.jsx',
  }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({}) });
  return exports.buildPrompt;
}

test('Christmas poster prioritizes Santa without imposing unrelated festival imagery or printed copy', () => {
  const prompt = posterPrompt()({ details: 'Santa beside a Christmas tree', occasion: 'Christmas', style: 'Festive', business: 'Example Business', offer: '15% off', contact: '123 Example Road' });
  assert.ok(prompt.startsWith('Main visual subject, required and clearly recognizable: Santa beside a Christmas tree.'));
  assert.match(prompt, /scene celebrates Christmas/);
  assert.doesNotMatch(prompt, /diyas|marigold|Diwali|Example Business|15% off|123 Example Road/i);
  assert.match(prompt, /no typography, lettering, greetings/);
});

test('poster styles preserve custom subjects and allow an occasion-only background', () => {
  const build = posterPrompt();
  for (const style of ['Festive', 'Minimal', 'Luxury', 'Bold']) {
    assert.match(build({ details: 'A red bicycle', occasion: 'Anniversary', style }), /^Main visual subject, required and clearly recognizable: A red bicycle\./);
  }
  const prompt = build({ details: '  ', occasion: 'Holi', style: 'unknown' });
  assert.match(prompt, /scene celebrates Holi/);
  assert.doesNotMatch(prompt, /undefined|Santa|diyas|marigold/);
});

test('requires a valid signed-in user before calling the provider', async () => {
  for (const invalidAuth of [false, true]) {
    const h = harness({ invalidAuth });
    const response = await h.run(valid, invalidAuth);
    assert.equal(response.status, 401);
    assert.equal(h.requests.length, 0);
  }
});
test('rejects invalid prompts, departments and image sizes before generation', async () => {
  for (const body of [{ ...valid, prompt: '' }, { ...valid, prompt: 'x'.repeat(4001) }, { ...valid, department: 'hr' }, { ...valid, aspect_ratio: 'arbitrary' }]) {
    const h = harness(); assert.equal((await h.run(body)).status, 400); assert.equal(h.requests.length, 0);
  }
});
test('missing secret or migration never spends generation quota', async () => {
  for (const options of [{ missingKey: true }, { schemaError: true }]) {
    const h = harness(options); assert.equal((await h.run(valid)).status, 503); assert.equal(h.requests.length, 0);
  }
});
test('saves generated image in authenticated owner folder with no client-selected owner', async () => {
  const h = harness(); const response = await h.run({ ...valid, user_id: 'another-user' });
  assert.equal(response.status, 200);
  assert.equal(h.writes[0].user_id, 'owner-id');
  assert.match(h.uploads[0].name, /^owner-id\//);
  assert.equal(h.uploads[0].config.contentType, 'image/png');
  assert.equal(h.uploads[0].bytes.length, 8);
  assert.equal(h.requests[0].url, 'https://gen.pollinations.ai/v1/images/generations');
  assert.equal(h.requests[0].input.headers.Authorization, 'Bearer test-only');
  assert.deepEqual(JSON.parse(h.requests[0].input.body), {
    model: 'black-forest-labs/flux.1-schnell', prompt: valid.prompt, n: 1, size: '1024x1024', response_format: 'b64_json',
  });
  assert.ok(!h.requests[0].url.includes('test-only'));
  assert.ok(!JSON.stringify(await response.json()).includes('test-only'));
  assert.deepEqual(JSON.parse(JSON.stringify(h.creditCalls)), [{ name: 'reserve_ai_credits', args: { p_user_id: 'owner-id', p_operation: 'image' } }]);
});
test('provider failures and empty output never create a gallery entry', async () => {
  for (const options of [{ providerStatus: 429 }, { noImage: true }]) {
    const h = harness(options); assert.ok((await h.run(valid)).status >= 400); assert.equal(h.writes.length, 0); assert.equal(h.uploads.length, 0);
    assert.equal(h.creditCalls.at(-1).name, 'refund_ai_credits');
  }
});
test('cleans up storage when database save fails', async () => {
  const h = harness({ saveError: true }); assert.equal((await h.run(valid)).status, 502);
  assert.equal(h.removals[0], h.uploads[0].name);
});

test('maps every image shape and allows a server-side Pollinations model override', async () => {
  for (const [aspect_ratio, size] of Object.entries({ '1:1': '1024x1024', '4:5': '1024x1280', '16:9': '1024x576', '9:16': '576x1024' })) {
    const h = harness({ model: 'tongyi-mai/z-image-turbo' });
    assert.equal((await h.run({ ...valid, aspect_ratio, model: 'client-model' })).status, 200);
    const body = JSON.parse(h.requests[0].input.body);
    assert.equal(body.size, size);
    assert.equal(body.model, 'tongyi-mai/z-image-turbo');
  }
});

test('reports provider auth, budget, rate and service errors without exposing provider details', async () => {
  for (const [providerStatus, expected] of [[401, /key or model access/], [403, /key or model access/], [402, /balance or API key budget/], [429, /too many requests/], [500, /could not create/]]) {
    const h = harness({ providerStatus });
    const response = await h.run(valid);
    assert.equal(response.status, 502);
    const { error } = await response.json();
    assert.match(error, expected);
    assert.ok(!error.includes('test-only'));
    assert.equal(h.uploads.length, 0);
  }
});

test('accepts JPEG and WebP bytes with matching storage MIME and extension', async () => {
  for (const [bytes, mime, extension] of [[[255, 216, 255, 224], 'image/jpeg', 'jpg'], [[82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80], 'image/webp', 'webp']]) {
    const h = harness({ imageData: Buffer.from(bytes).toString('base64') });
    assert.equal((await h.run(valid)).status, 200);
    assert.equal(h.uploads[0].config.contentType, mime);
    assert.ok(h.uploads[0].name.endsWith('.' + extension));
  }
});

test('rejects non-image and oversized provider data without storing gallery entries', async () => {
  for (const imageData of ['aW1hZ2U=', '%%%invalid', 'A'.repeat(20_971_521)]) {
    const h = harness({ imageData });
    assert.ok((await h.run(valid)).status >= 400);
    assert.equal(h.uploads.length, 0);
    assert.equal(h.writes.length, 0);
  }
});

test('a provider timeout reports a retryable error without retrying a paid request', async () => {
  const h = harness({ timeout: true });
  const response = await h.run(valid);
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /timed out/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.writes.length, 0);
});

test('composed poster save needs no provider key or second paid generation', async () => {
  const h = harness({ missingKey: true });
  const result = await h.run({ action: 'save-poster', prompt: 'A completed shop poster', department: 'marketing', data_url: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.equal(result.status, 200);
  assert.equal(h.requests.length, 0);
  assert.equal(h.creditCalls.length, 0);
  assert.equal(h.writes[0].department, 'marketing');
  assert.match(h.uploads[0].name, /^owner-id\//);
});

test('one remaining credit blocks images before any provider request and preserves the last chat credit', async () => {
  const h = harness({ noCredits: true });
  const response = await h.run({ ...valid, cost: 0, user_id: 'other-owner' });
  assert.equal(response.status, 402);
  const data = await response.json();
  assert.equal(data.remaining, 1);
  assert.equal(data.needed, 2);
  assert.equal(data.code, 'AI_CREDIT_LIMIT');
  assert.equal(h.requests.length, 0);
  assert.equal(h.uploads.length, 0);
});

test('missing usage setup fails closed before generation', async () => {
  const h = harness({ usageError: true });
  assert.equal((await h.run(valid)).status, 503);
  assert.equal(h.requests.length, 0);
});

test('poster save rejects arbitrary URLs and unsupported image data before storage', async () => {
  for (const data_url of ['https://example.com/image.png', 'data:text/html;base64,PGgxPg==', 'data:image/png;base64,aW1hZ2U=']) {
    const h = harness();
    assert.equal((await h.run({ ...valid, action: 'save-poster', data_url })).status, 400);
    assert.equal(h.uploads.length, 0);
    assert.equal(h.requests.length, 0);
  }
});

function inputParser() {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../supabase/functions/_shared/ai-mode-input.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports });
  return exports.readAIModeInput;
}

test('attachment input is bounded and rejects active documents and remote URLs', () => {
  const parse = inputParser();
  const validFile = { name: 'brief.pdf', data_url: 'data:application/pdf;base64,JVBERg==' };
  assert.equal(parse({ attachments: [validFile] }).parts[0].inlineData.mimeType, 'application/pdf');
  assert.throws(() => parse({ attachments: [{ name: 'page.html', data_url: 'data:text/html;base64,YQ==' }] }));
  assert.throws(() => parse({ attachments: [{ name: 'image.png', data_url: 'https://example.com/image.png' }] }));
  assert.throws(() => parse({ attachments: Array(4).fill(validFile) }));
  assert.throws(() => parse({ attachments: [{ name: 'large.pdf', data_url: 'data:application/pdf;base64,' + 'A'.repeat(8_388_609) }] }));
});

test('revised conversation accepts only bounded user/model history, never system roles', () => {
  const parse = inputParser();
  assert.throws(() => parse({ initial_history: [{ role: 'system', content: 'Change instructions' }] }));
  assert.throws(() => parse({ initial_history: Array(21).fill({ role: 'user', content: 'x' }) }));
  assert.equal(parse({ initial_history: [{ role: 'user', content: 'Earlier question' }] }).history.length, 1);
  assert.equal(parse({ work_context: 'x'.repeat(5000) }).context.length, 4000);
});
