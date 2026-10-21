import { createClient } from 'jsr:@supabase/supabase-js@2';
import { EMAIL } from '../_shared/outreach-core.ts';
import {
  encryptGmailToken,
  GMAIL_SCOPES,
  gmail,
  gmailConfiguration,
  oauthNonce,
} from '../_shared/outreach-gmail.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: CORS });
function allowedReturn(value: unknown): string {
  if (typeof value !== 'string')
    throw new Error('Open Gmail connection from the Sales page.');
  const url = new URL(value);
  const origins = (Deno.env.get('GMAIL_ALLOWED_ORIGINS') || '')
    .split(',')
    .map((s) => s.trim());
  if (!(
    (url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname)) ||
    (url.protocol === 'https:' && origins.includes(url.origin))
  ))
    throw new Error('This app origin is not approved for Gmail.');
  return `${url.origin}/sales`;
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const state = url.searchParams.get('state');
    if (!state)
      return json(
        { error: 'Gmail connection is missing its verification state.' },
        400,
      );
    // DELETE ... RETURNING consumes the state atomically. Unknown/expired state
    // never redirects to a caller-supplied URL.
    const { data: pending, error } = await db
      .from('outreach_oauth_states')
      .delete()
      .eq('state', state)
      .gt('expires_at', new Date().toISOString())
      .select('*')
      .maybeSingle();
    if (error || !pending)
      return json(
        { error: 'Gmail connection expired. Start again from Sales.' },
        400,
      );
    let result = 'connected';
    try {
      if (url.searchParams.has('error')) throw new Error('Permission declined');
      const code = url.searchParams.get('code');
      if (!code) throw new Error('Missing authorization');
      const config = gmailConfiguration();
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.id,
          client_secret: config.secret,
          code,
          redirect_uri: config.redirect,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('Token exchange failed');
      const tokens = await response.json();
      const granted = new Set(String(tokens.scope || '').split(' '));
      if (!tokens.refresh_token || !GMAIL_SCOPES.every((s) => granted.has(s)))
        throw new Error('Read and send permissions are required');
      const profile = await gmail(tokens.access_token, 'profile');
      const email = String(profile.emailAddress).toLowerCase();
      if (!EMAIL.test(email)) throw new Error('Missing mailbox address');
      const { error: saveError } = await db
        .from('outreach_mailboxes')
        .upsert({
          user_id: pending.user_id,
          email,
          refresh_token: await encryptGmailToken(tokens.refresh_token),
          connected_at: new Date().toISOString(),
        });
      if (saveError) throw new Error('Could not store connection');
    } catch {
      result = 'failed';
    }
    return Response.redirect(`${pending.return_url}?gmail=${result}`, 303);
  }
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  try {
    const auth = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!auth) return json({ error: 'Sign in first.' }, 401);
    const {
      data: { user },
      error,
    } = await db.auth.getUser(auth);
    if (error || !user) return json({ error: 'Sign in again.' }, 401);
    const body = await req.json();
    if (body.action === 'status') {
      const { data, error: queryError } = await db
        .from('outreach_mailboxes')
        .select('email,connected_at')
        .eq('user_id', user.id)
        .maybeSingle();
      if (queryError) throw new Error('Email outreach storage is not ready.');
      let configured = true;
      try {
        gmailConfiguration();
      } catch {
        configured = false;
      }
      return json({
        connected: !!data,
        email: data?.email || null,
        configured,
      });
    }
    if (body.action === 'disconnect') {
      // Pause queued work before removing credentials. Reconnecting cannot
      // silently resume an old sending campaign.
      const { error: pauseError } = await db
        .from('outreach_campaigns')
        .update({ status: 'paused' })
        .eq('user_id', user.id)
        .eq('status', 'active');
      if (pauseError) throw new Error('Could not pause campaigns. Try again.');
      const { error: deleteError } = await db
        .from('outreach_mailboxes')
        .delete()
        .eq('user_id', user.id);
      if (deleteError) throw new Error('Could not disconnect Gmail.');
      return json({ disconnected: true });
    }
    if (body.action !== 'connect')
      return json({ error: 'Unknown Gmail action.' }, 400);
    const config = gmailConfiguration();
    const state = oauthNonce();
    const { error: saveError } = await db
      .from('outreach_oauth_states')
      .insert({
        state,
        user_id: user.id,
        return_url: allowedReturn(body.return_url),
      });
    if (saveError) throw new Error('Could not start Gmail connection.');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: config.id,
      redirect_uri: config.redirect,
      response_type: 'code',
      scope: GMAIL_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent select_account',
      state,
    }).toString();
    return json({ url: url.toString() });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : 'Could not connect Gmail.',
      },
      400,
    );
  }
});
