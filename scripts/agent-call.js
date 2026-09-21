// Has the ElevenLabs agent phone someone for a live, two-way conversation, then
// prints what was said.
//
//   node scripts/agent-call.js +919876543210 --link
//   node scripts/agent-call.js +919876543210
//   node scripts/agent-call.js +919876543210 --opening "Hi, this is Alex from Synq."
//   node scripts/agent-call.js +919876543210 --from +16592096040
//
// The calling number comes from --from, then AGENT_FROM_NUMBER, then
// TWILIO_FROM_NUMBER. It has its own setting because ElevenLabs can only link a
// number your Twilio account owns, while a trial's recorded test calls may need
// a different, Twilio-assigned number that the account does not own.
//
// Unlike twilio-test-call.js, nothing is pre-recorded: ElevenLabs runs the call,
// listening and replying in real time, through the Twilio number it has been
// linked to.
//
// --link is required the first time, and deliberately so. Linking hands your
// Twilio credentials to ElevenLabs and lets it reconfigure that Twilio number,
// which changes how the number answers incoming calls. That should never happen
// as a side effect of placing a test call.
//
// The destination is a required argument on purpose. A default number here
// would eventually call someone who did not expect it.

const { readEnvFile, pick } = require('./lib/env');

const API = 'https://api.elevenlabs.io';
const DEFAULT_AGENT_ID = 'agent_2101m07rczdjf9fa6sw245vzgd1d';
const POLL_INTERVAL_MS = 5000;
// The agent is capped at 600 seconds of conversation; allow for ringing and
// post-call processing on top of that.
const POLL_LIMIT_MS = 13 * 60 * 1000;

function parseArgs(argv) {
  const [to, ...rest] = argv;
  const options = { to, link: false, opening: null, from: null };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--link') options.link = true;
    else if (rest[i] === '--opening') options.opening = rest[++i];
    else if (rest[i] === '--from') options.from = rest[++i];
    else throw new Error(`Unknown option "${rest[i]}". Use --link, --opening "..." or --from +1....`);
  }
  return options;
}

async function elevenlabs(key, method, path, body) {
  let response;
  try {
    response = await fetch(API + path, {
      method,
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    throw new Error(`Could not reach ElevenLabs: ${cause.message}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.detail;
    const message =
      typeof detail === 'string'
        ? detail
        : detail?.message || (Array.isArray(detail) ? detail.map((d) => d.msg).join('; ') : '') ||
          JSON.stringify(payload).slice(0, 300);
    const hint =
      detail?.status === 'missing_permissions'
        ? '\nEdit the ElevenLabs API key and enable the permission named above.'
        : /override/i.test(message)
          ? '\nThe agent does not allow this per-call change. Enable it in the agent\'s security settings, or drop --opening.'
          : '';
    throw new Error(`ElevenLabs refused ${method} ${path} (HTTP ${response.status}): ${message}${hint}`);
  }
  return payload;
}

/**
 * ElevenLabs can only link a number the Twilio account owns. Checking first
 * turns a vague import failure into a sentence that names the number.
 */
async function assertTwilioOwns(env, number) {
  const sid = pick(env, 'TWILIO_ACCOUNT_SID');
  const token = pick(env, 'TWILIO_AUTH_TOKEN');
  if (!sid || !token) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are needed in .env.local to check the number.');
  }
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const url =
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=` +
    encodeURIComponent(number);

  let response;
  try {
    response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  } catch (cause) {
    throw new Error(`Could not reach Twilio: ${cause.message}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Twilio refused the ownership check (HTTP ${response.status}): ${payload.message || 'no details'}`);
  }
  const owned = (payload.incoming_phone_numbers || []).find((n) => n.phone_number === number);
  if (!owned) {
    throw new Error(
      `${number} is not a number your Twilio account owns, so ElevenLabs cannot link it.
` +
        'Pass --from with a number listed under Phone Numbers in the Twilio console, or set AGENT_FROM_NUMBER.'
    );
  }
  if (!owned.capabilities?.voice) throw new Error(`${number} cannot make voice calls.`);
}

/** Returns the ElevenLabs id for the linked number, linking it only if allowed. */
async function linkedNumberId({ key, env, from, agentId, allowLink }) {
  const numbers = await elevenlabs(key, 'GET', '/v1/convai/phone-numbers');
  const existing = (Array.isArray(numbers) ? numbers : []).find((n) => n.phone_number === from);
  if (existing) return { id: existing.phone_number_id, linkedNow: false };

  await assertTwilioOwns(env, from);

  if (!allowLink) {
    throw new Error(
      `${from} is not linked to ElevenLabs yet. Run again with --link to link it.\n` +
        'Linking lets ElevenLabs reconfigure that Twilio number, including how it answers incoming calls.'
    );
  }

  const sid = pick(env, 'TWILIO_ACCOUNT_SID');
  const token = pick(env, 'TWILIO_AUTH_TOKEN');
  if (!sid || !token) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are needed in .env.local to link the number.');
  }

  const created = await elevenlabs(key, 'POST', '/v1/convai/phone-numbers', {
    provider: 'twilio',
    phone_number: from,
    label: 'Synq outbound',
    sid,
    token,
    agent_id: agentId,
  });
  return { id: created.phone_number_id, linkedNow: true };
}

async function waitForConversation(key, conversationId) {
  const started = Date.now();
  let lastStatus = '';
  while (Date.now() - started < POLL_LIMIT_MS) {
    const conversation = await elevenlabs(key, 'GET', `/v1/convai/conversations/${conversationId}`);
    if (conversation.status !== lastStatus) {
      console.log(`${new Date().toISOString().slice(11, 19)} status: ${conversation.status}`);
      lastStatus = conversation.status;
    }
    if (conversation.status === 'done' || conversation.status === 'failed') return conversation;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('Stopped waiting after 13 minutes without the conversation finishing.');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.to) {
    console.error('Usage: node scripts/agent-call.js +<number in E.164> [--link] [--opening "..."] [--from +1...]');
    process.exit(1);
  }
  if (!/^\+\d{8,15}$/.test(options.to)) {
    console.error(`"${options.to}" is not E.164. It needs a leading + and country code, e.g. +919876543210`);
    process.exit(1);
  }

  const env = readEnvFile();
  const key = pick(env, 'ELEVENLABS_API_KEY', 'ELEVEN_LABS_API');
  const agentId = pick(env, 'ELEVENLABS_AGENT_ID') || DEFAULT_AGENT_ID;
  const from = (options.from || pick(env, 'AGENT_FROM_NUMBER', 'TWILIO_FROM_NUMBER') || '').trim();
  if (!key) throw new Error('No ElevenLabs API key in .env.local.');
  if (!from) {
    throw new Error('No calling number. Pass --from, or set AGENT_FROM_NUMBER in .env.local to a number your Twilio account owns.');
  }

  console.log(`1/3 Checking ${from} is linked to ElevenLabs`);
  const number = await linkedNumberId({ key, env, from, agentId, allowLink: options.link });
  console.log(`    ${number.linkedNow ? 'linked just now' : 'already linked'} (${number.id})`);

  console.log(`2/3 Asking the agent to call ${options.to}`);
  const body = { agent_id: agentId, agent_phone_number_id: number.id, to_number: options.to };
  if (options.opening) {
    body.conversation_initiation_client_data = {
      conversation_config_override: { agent: { first_message: options.opening } },
    };
  }
  const call = await elevenlabs(key, 'POST', '/v1/convai/twilio/outbound-call', body);
  if (!call.success) throw new Error(`ElevenLabs did not place the call: ${call.message}`);
  console.log(`    Conversation: ${call.conversation_id}`);
  console.log(`    Twilio call:  ${call.callSid}`);

  console.log('3/3 Waiting for the conversation to finish');
  const conversation = await waitForConversation(key, call.conversation_id);

  console.log(`\nDuration: ${conversation.metadata?.call_duration_secs ?? '?'} seconds`);
  const turns = (conversation.transcript || []).filter((t) => (t.message || '').trim());
  if (turns.length === 0) {
    console.log('No one spoke. The call may not have been answered.');
  } else {
    console.log('Transcript:');
    for (const turn of turns) console.log(`  ${turn.role === 'agent' ? 'Agent' : 'Caller'}: ${turn.message}`);
  }
  if (conversation.analysis?.transcript_summary) {
    console.log(`\nSummary: ${conversation.analysis.transcript_summary}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
