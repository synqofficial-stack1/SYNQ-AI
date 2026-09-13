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

function resolveCredentials(env) {
  const accountSid = env.TWILIO_ACCOUNT_SID;

  // Twilio takes either the account's own auth token, or an API key pair. The
  // account SID is needed either way, because it is part of the request path.
  const apiKeySid = env.TWILIO_API_KEY_SID || env.TWILIO_SALES_CALLIN_API;
  const apiKeySecret = env.TWILIO_API_KEY_SECRET || env.TWILIO_CLIENT_SECRET;
  const authToken = env.TWILIO_AUTH_TOKEN;

  if (!accountSid) {
    throw new Error(
      'TWILIO_ACCOUNT_SID is missing from .env.local. It starts with "AC" and is on the\n' +
        'front page of the Twilio console. The API key you already saved cannot replace it,\n' +
        'because the account SID is part of the request URL.'
    );
  }
  if (!accountSid.startsWith('AC')) {
    throw new Error(`TWILIO_ACCOUNT_SID should start with "AC", but starts with "${accountSid.slice(0, 2)}".`);
  }

  if (apiKeySid && apiKeySecret) return { accountSid, user: apiKeySid, pass: apiKeySecret };
  if (authToken) return { accountSid, user: accountSid, pass: authToken };

  throw new Error(
    'No usable Twilio credentials. Set either TWILIO_AUTH_TOKEN, or an API key pair\n' +
      '(TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET) in .env.local.'
  );
}

function escapeXml(text) {
  return text.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]
  );
}

async function placeTestCall(to) {
  const { accountSid, user, pass } = resolveCredentials(readEnvFile(ENV_FILE));

  // Inline TwiML, so this needs no public URL for Twilio to fetch.
  const twiml = `<Response><Say voice="alice">${escapeXml(MESSAGE)}</Say></Response>`;

  const body = new URLSearchParams({ To: to, From: FROM_NUMBER, Twiml: twiml });
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');

  let response;
  try {
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      }
    );
  } catch (cause) {
    throw new Error(`Could not reach Twilio: ${cause.message}`);
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    // Twilio's own error codes say far more than the HTTP status does.
    const detail = payload.message || `HTTP ${response.status}`;
    const hint =
      payload.code === 21219 || payload.code === 21210
        ? '\nOn a trial account you can only call numbers you have verified in the console.'
        : payload.code === 20003
          ? '\nThe credentials were rejected. Check the API key pair and the account SID.'
          : payload.code === 21212 || payload.code === 21606
            ? `\n${FROM_NUMBER} is not a number this account can call from.`
            : '';
    throw new Error(`Twilio refused the call (code ${payload.code ?? '?'}): ${detail}${hint}`);
  }

  return payload;
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
  console.log(`Calling ${to} from ${FROM_NUMBER}`);
  console.log(`Call SID: ${call.sid}`);
  console.log(`Status:   ${call.status}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
