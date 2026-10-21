// Tokens remain server-side and are encrypted before being saved.
import { type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { base64url } from './outreach-core.ts';

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];
export function gmailConfiguration() {
  const id = Deno.env.get('GMAIL_CLIENT_ID');
  const secret = Deno.env.get('GMAIL_CLIENT_SECRET');
  if (!id || !secret || !Deno.env.get('GMAIL_TOKEN_ENCRYPTION_KEY'))
    throw new Error(
      'Gmail connection needs setup. Add the Gmail OAuth client and encryption key to the server first.',
    );
  return {
    id,
    secret,
    redirect: `${Deno.env.get('SUPABASE_URL')}/functions/v1/gmail-auth`,
  };
}
async function tokenKey() {
  const hex = Deno.env.get('GMAIL_TOKEN_ENCRYPTION_KEY') || '';
  if (!/^[a-f0-9]{64}$/i.test(hex))
    throw new Error('Gmail token encryption needs a 32-byte hex key.');
  return crypto.subtle.importKey(
    'raw',
    Uint8Array.from(hex.match(/../g)!, (v) => parseInt(v, 16)),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}
const pack = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
function unpack(s: string) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b + '='.repeat((4 - (b.length % 4)) % 4)), (c) =>
    c.charCodeAt(0),
  );
}
export async function encryptGmailToken(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return `${pack(iv)}.${pack(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(), new TextEncoder().encode(value))))}`;
}
async function decryptGmailToken(value: string) {
  const [iv, data] = value.split('.');
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unpack(iv) },
      await tokenKey(),
      unpack(data),
    ),
  );
}
export class GmailError extends Error {
  constructor(public status: number) {
    super(
      status === 401 || status === 403
        ? 'Gmail access expired or was denied. Reconnect Gmail and check API permissions.'
        : status === 429
          ? 'Gmail is rate-limiting requests. Wait before trying again.'
          : 'Gmail could not complete this request.',
    );
  }
}
export async function gmail(
  token: string,
  path: string,
  init: RequestInit = {},
) {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw new GmailError(response.status);
  return response.json();
}
export async function mailboxAccess(db: SupabaseClient, userId: string) {
  const { data, error } = await db
    .from('outreach_mailboxes')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error('Could not load the Gmail connection.');
  if (!data) throw new Error('Connect Gmail before sending or syncing.');
  const config = gmailConfiguration();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.id,
      client_secret: config.secret,
      refresh_token: await decryptGmailToken(data.refresh_token),
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error('Gmail authorization expired. Reconnect Gmail.');
  const tokens = await response.json();
  if (!tokens.access_token)
    throw new Error('Gmail did not return an access token. Reconnect Gmail.');
  return { token: tokens.access_token as string, email: data.email as string };
}
// Keep unused exports out of frontend bundles: this module is Edge-only.
export const oauthNonce = () =>
  base64url(crypto.randomUUID() + crypto.randomUUID());
