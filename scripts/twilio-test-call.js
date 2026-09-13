// Places one real outbound call through Twilio and prints the call SID.
//
// This exists to answer one question before any of the ElevenLabs wiring is
// trusted: can this account actually make a phone ring? If this script fails,
// nothing built on top of it can work, and the fault is in Twilio rather than
// in Synq.
//
//   node scripts/twilio-test-call.js +919876543210
//
// The destination is a required argument on purpose. A default number here
// would eventually call someone who did not expect it.

const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env.local');
const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || '+17372508034';
const MESSAGE = 'Hello, this is a test call.';

/** Minimal .env reader: strips inline "# note" comments and surrounding quotes. */
function readEnvFile(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed
      .slice(index + 1)
      .split(/\s+#/)[0]
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key) values[key] = value;
  }
  return values;
}

/** Twilio auth failures, as opposed to a refusal of the call itself. */
const AUTH_ERROR_CODES = new Set([20003, 8001]);

function resolveCredentials(env) {
  const accountSid = env.TWILIO_ACCOUNT_SID;

  if (!accountSid) {
    throw new Error(
      'TWILIO_ACCOUNT_SID is missing from .env.local. It starts with "AC" and is on the\n' +
        'front page of the Twilio console. An API key cannot replace it, because the\n' +
        'account SID is part of the request URL.'
    );
  }
  if (!accountSid.startsWith('AC')) {
    throw new Error(`TWILIO_ACCOUNT_SID should start with "AC", but starts with "${accountSid.slice(0, 2)}".`);
  }

  // Twilio takes either an API key pair or the account's own auth token. Both
  // are tried in that order, because an API key can be revoked in the console
  // without anything in this file changing — and when that happens the error
  // says "actor doesn't have any assertions", which explains nothing.
  const candidates = [];
  const apiKeySid = env.TWILIO_API_KEY_SID || env.TWILIO_SALES_CALLIN_API;
  const apiKeySecret = env.TWILIO_API_KEY_SECRET || env.TWILIO_CLIENT_SECRET;

  if (apiKeySid && apiKeySecret) {
    candidates.push({ label: 'API key', user: apiKeySid, pass: apiKeySecret });
  }
  if (env.TWILIO_AUTH_TOKEN) {
    candidates.push({ label: 'auth token', user: accountSid, pass: env.TWILIO_AUTH_TOKEN });
  }

  if (candidates.length === 0) {
    throw new Error(
      'No usable Twilio credentials. Set either TWILIO_AUTH_TOKEN, or an API key pair\n' +
        '(TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET) in .env.local.'
    );
  }

  return { accountSid, candidates };
}

function escapeXml(text) {
  return text.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]
  );
}

async function placeTestCall(to) {
  const { accountSid, candidates } = resolveCredentials(readEnvFile(ENV_FILE));

  // Inline TwiML, so this needs no public URL for Twilio to fetch.
  const twiml = `<Response><Say voice="alice">${escapeXml(MESSAGE)}</Say></Response>`;
  const body = new URLSearchParams({ To: to, From: FROM_NUMBER, Twiml: twiml });
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;

  let lastError = null;

  for (const credential of candidates) {
    const auth = Buffer.from(`${credential.user}:${credential.pass}`).toString('base64');

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
    } catch (cause) {
      throw new Error(`Could not reach Twilio: ${cause.message}`);
    }

    const payload = await response.json().catch(() => ({}));
    if (response.ok) return { ...payload, usedCredential: credential.label };

    // Only a rejected credential is worth retrying with another one. A refused
    // call would be refused identically however we authenticate, and retrying
    // it risks placing the same call twice.
    if (AUTH_ERROR_CODES.has(payload.code) && credential !== candidates[candidates.length - 1]) {
      lastError = `${credential.label} rejected (code ${payload.code})`;
      continue;
    }

    // Twilio's own error codes say far more than the HTTP status does.
    const detail = payload.message || `HTTP ${response.status}`;
    const hint =
      payload.code === 21219 || payload.code === 21210
        ? '\nThis is a trial account, so you can only call numbers verified in the Twilio console.'
        : AUTH_ERROR_CODES.has(payload.code)
          ? '\nEvery credential in .env.local was rejected. Check them in the Twilio console.'
          : payload.code === 21212 || payload.code === 21606
            ? `\n${FROM_NUMBER} is not a number this account can call from. Buy a number in the` +
              '\nTwilio console, or set TWILIO_FROM_NUMBER to one you already own.'
            : '';
    const preamble = lastError ? `${lastError}, then ` : '';
    throw new Error(`${preamble}Twilio refused the call (code ${payload.code ?? '?'}): ${detail}${hint}`);
  }

  throw new Error(lastError ?? 'No Twilio credential was accepted.');
}

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error('Usage: node scripts/twilio-test-call.js +<number in E.164>');
    console.error('Example: node scripts/twilio-test-call.js +919876543210');
    process.exit(1);
  }
  if (!/^\+\d{8,15}$/.test(to)) {
    console.error(`"${to}" is not E.164. It needs a leading + and country code, e.g. +919876543210`);
    process.exit(1);
  }

  const call = await placeTestCall(to);
  console.log(`Calling ${to} from ${FROM_NUMBER} (authenticated with the ${call.usedCredential})`);
  console.log(`Call SID: ${call.sid}`);
  console.log(`Status:   ${call.status}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
