// Turns a text script into spoken audio with ElevenLabs, in the voice set by
// ELEVENLABS_VOICE_ID.
//
//   node scripts/generate-speech.js "Hello, this is Synq."
//   node scripts/generate-speech.js --file script.txt --out greeting.mp3
//
// Also used by twilio-test-call.js, which is why the work lives in an exported
// function rather than only in main().

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readEnvFile, pick } = require('./lib/env');

const DEFAULT_MODEL = 'eleven_multilingual_v2';
// A phone line carries 8 kHz audio, so anything richer is thrown away by the
// carrier before anyone hears it. This keeps the file small for Twilio to fetch.
const OUTPUT_FORMAT = 'mp3_22050_32';
const MAX_CHARS = 2500;

async function generateSpeech(text, env = readEnvFile()) {
  const apiKey = pick(env, 'ELEVENLABS_API_KEY', 'ELEVEN_LABS_API');
  const voiceId = pick(env, 'ELEVENLABS_VOICE_ID');
  const modelId = pick(env, 'ELEVENLABS_MODEL_ID') || DEFAULT_MODEL;

  if (!apiKey) {
    throw new Error('No ElevenLabs API key in .env.local. Expected ELEVENLABS_API_KEY or ELEVEN_LABS_API.');
  }
  if (!voiceId) throw new Error('No ELEVENLABS_VOICE_ID in .env.local.');

  const script = String(text ?? '').trim();
  if (!script) throw new Error('There is no text to speak.');
  if (script.length > MAX_CHARS) {
    throw new Error(`The script is ${script.length} characters. Keep it under ${MAX_CHARS}.`);
  }

  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}` +
    `?output_format=${OUTPUT_FORMAT}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: script, model_id: modelId }),
    });
  } catch (cause) {
    throw new Error(`Could not reach ElevenLabs: ${cause.message}`);
  }

  if (!response.ok) {
    const raw = await response.text();
    let detail = {};
    try {
      detail = JSON.parse(raw).detail ?? {};
    } catch {
      // Not JSON; fall back to the raw text below.
    }
    const message =
      typeof detail === 'string' ? detail : detail.message || raw.slice(0, 300) || 'no details';

    let hint = '';
    if (detail.status === 'missing_permissions') {
      hint =
        '\nThis API key is restricted. In your ElevenLabs account, edit the key and enable its' +
        '\nText to Speech permission, or create a new key with that permission.';
    } else if (response.status === 401) {
      hint = '\nElevenLabs rejected the key itself. Check ELEVEN_LABS_API in .env.local.';
    } else if (response.status === 404 || detail.status === 'voice_not_found') {
      hint = `\nNo voice with id ${voiceId}. Check ELEVENLABS_VOICE_ID in .env.local.`;
    } else if (response.status === 429 || detail.status === 'quota_exceeded') {
      hint = '\nThe ElevenLabs character allowance is used up for this billing period.';
    }
    throw new Error(`ElevenLabs refused (HTTP ${response.status}): ${message}${hint}`);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) throw new Error('ElevenLabs returned an empty audio file.');
  return audio;
}

function parseArgs(argv) {
  const options = { text: null, file: null, out: path.join(os.tmpdir(), 'synq-speech.mp3') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') options.file = argv[++i];
    else if (argv[i] === '--out') options.out = argv[++i];
    else if (options.text === null) options.text = argv[i];
    else throw new Error(`Unexpected argument "${argv[i]}".`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const text = options.file ? fs.readFileSync(options.file, 'utf8') : options.text;
  if (!text) {
    console.error('Usage: node scripts/generate-speech.js "text to speak" [--out file.mp3]');
    console.error('   or: node scripts/generate-speech.js --file script.txt [--out file.mp3]');
    process.exit(1);
  }

  const audio = await generateSpeech(text);
  fs.writeFileSync(options.out, audio);
  console.log(`Saved ${audio.length} bytes of speech to ${options.out}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { generateSpeech };
