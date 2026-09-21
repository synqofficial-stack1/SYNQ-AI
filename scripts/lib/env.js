// Shared .env.local reading for the scripts in this folder.

const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '..', '.env.local');

/** Minimal .env reader: strips inline "# note" comments and surrounding quotes. */
function readEnvFile(file = ENV_FILE) {
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

/**
 * The first non-empty value among `names`. The shell wins over the file, so a
 * one-off `TWILIO_FROM_NUMBER=+1... node ...` overrides without editing anything.
 */
function pick(env, ...names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
    if (env[name]) return env[name];
  }
  return undefined;
}

module.exports = { ENV_FILE, readEnvFile, pick };
