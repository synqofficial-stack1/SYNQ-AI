// Hosts one mp3 so a phone call can play it.
//
// Twilio's <Play> fetches audio from a public address at the moment the call
// connects. Generated speech starts life on a laptop, Twilio's own file hosting
// is closed to trial accounts, and a public bucket would be free hosting for
// anyone who reads the app bundle. So this takes the bytes, stores them in a
// private bucket, and hands back a signed link that expires in an hour.
//
// The anon key ships inside the app, so passing the gateway's JWT check proves
// nothing about who is calling. A second credential gates this function: a
// random token that lives only in the developer's .env.local. Its SHA-256 is
// embedded below. A hash of 256 random bits cannot be reversed, so it is safe
// to commit; rotating the token means redeploying with the new hash.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const TOKEN_SHA256 = '966b11b27841e594858dc891ea701086b205886171054665babc930d22d11c3e';
const BUCKET = 'call-audio';
const MAX_BYTES = 5 * 1024 * 1024;
const LINK_TTL_SECONDS = 60 * 60;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time, so response timing does not reveal how much of a guess matched. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** An ID3 tag or an MPEG frame sync. Anything else is not an mp3 and is refused. */
function looksLikeMp3(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const token = req.headers.get('x-synq-token') ?? '';
  if (!token || !timingSafeEqual(await sha256Hex(token), TOKEN_SHA256)) {
    return json({ error: 'Not allowed.' }, 401);
  }

  // Refuse an oversized body before reading it into memory.
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) {
    return json({ error: `Audio is ${declared} bytes; the limit is ${MAX_BYTES}.` }, 413);
  }

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) return json({ error: 'No audio in the request body.' }, 400);
  if (bytes.length > MAX_BYTES) {
    return json({ error: `Audio is ${bytes.length} bytes; the limit is ${MAX_BYTES}.` }, 413);
  }
  if (!looksLikeMp3(bytes)) return json({ error: 'That is not an mp3 file.' }, 415);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const path = `calls/${Date.now()}-${crypto.randomUUID()}.mp3`;
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: 'audio/mpeg', upsert: false });
  if (uploadError) return json({ error: `Storing the audio failed: ${uploadError.message}` }, 502);

  const { data, error: signError } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, LINK_TTL_SECONDS);
  if (signError || !data?.signedUrl) {
    return json({ error: `Signing the link failed: ${signError?.message ?? 'no URL returned'}` }, 502);
  }

  return json({ path, url: data.signedUrl, expires_in: LINK_TTL_SECONDS });
});
