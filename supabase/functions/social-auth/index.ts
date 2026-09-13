// OAuth for the platforms Synq can post to: Instagram and X.
//
// One function, two audiences, which is why JWT verification is off at the
// gateway and done by hand below:
//
//   POST — the app, with a signed-in user's session. Asks which accounts are
//          connected, starts a connection, or removes one.
//   GET  — the platform, redirecting the user's browser back after they
//          approve. There is no Supabase session on that request; the single-use
//          `state` value is what ties it to the user who started the flow.
//
// Tokens never leave the server. The callback stores them and then redirects
// the popup to a page in the app that only learns "connected" or "failed". It
// redirects rather than rendering a page of its own because Supabase serves
// HTML from function URLs as plain text.

import { createClient } from 'jsr:@supabase/supabase-js@2';

type Platform = 'instagram' | 'x';
const PLATFORMS: Platform[] = ['instagram', 'x'];

// Only what posting needs. Messages and comments are left out on purpose: a
// login screen asking for more than the feature uses is a reason to say no.
const INSTAGRAM_SCOPES = 'instagram_business_basic,instagram_business_content_publish';
const X_SCOPES = 'tweet.write users.read media.write offline.access';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const NOT_CONFIGURED: Record<Platform, string> = {
  instagram:
    'Instagram posting is not set up yet. Add INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET to the Supabase secrets.',
  x: 'X posting is not set up yet. Add X_CLIENT_ID and X_CLIENT_SECRET to the Supabase secrets.',
};

type Connection = {
  account_id: string;
  account_name: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scopes: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );
}

function credentials(platform: Platform) {
  const id = Deno.env.get(platform === 'instagram' ? 'INSTAGRAM_APP_ID' : 'X_CLIENT_ID');
  const secret = Deno.env.get(platform === 'instagram' ? 'INSTAGRAM_APP_SECRET' : 'X_CLIENT_SECRET');
  return id && secret ? { id, secret } : null;
}

/** Must match, character for character, the redirect URI registered with each platform. */
function redirectUri() {
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/social-auth`;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(byteLength = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Sends the popup back to the app with an outcome, and nothing that identifies anyone. */
function finish(origin: string, platform: string, outcome: 'connected' | 'error', message = '') {
  const target = new URL('/oauth-complete', origin);
  target.searchParams.set('platform', platform);
  target.searchParams.set('status', outcome);
  if (message) target.searchParams.set('message', message.slice(0, 300));
  return new Response(null, { status: 302, headers: { Location: target.toString() } });
}

// deno-lint-ignore no-explicit-any
async function readJson(response: Response): Promise<any> {
  return await response.json().catch(() => ({}));
}

async function exchangeInstagram(
  code: string,
  creds: { id: string; secret: string }
): Promise<Connection> {
  const short = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: creds.id,
      client_secret: creds.secret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
      code,
    }),
  });
  const shortBody = await readJson(short);
  // Newer responses wrap the token in a data array; older ones do not.
  const shortToken = shortBody?.access_token ?? shortBody?.data?.[0]?.access_token;
  if (!short.ok || !shortToken) {
    throw new Error(
      shortBody?.error_message ?? shortBody?.error?.message ?? 'Instagram did not accept the login.'
    );
  }

  // Short-lived tokens last an hour. Posting a video can outlive that, and so
  // should the connection, so it is swapped for the 60-day token straight away.
  const longUrl = new URL('https://graph.instagram.com/access_token');
  longUrl.searchParams.set('grant_type', 'ig_exchange_token');
  longUrl.searchParams.set('client_secret', creds.secret);
  longUrl.searchParams.set('access_token', shortToken);
  const long = await fetch(longUrl);
  const longBody = await readJson(long);
  if (!long.ok || !longBody?.access_token) {
    throw new Error(longBody?.error?.message ?? 'Instagram would not issue a lasting login.');
  }

  const meUrl = new URL('https://graph.instagram.com/me');
  meUrl.searchParams.set('fields', 'user_id,username');
  meUrl.searchParams.set('access_token', longBody.access_token);
  const me = await fetch(meUrl);
  const meBody = await readJson(me);
  if (!me.ok) throw new Error(meBody?.error?.message ?? 'Could not read the Instagram account.');

  return {
    // `user_id` is the professional account id that publishing endpoints take.
    account_id: String(meBody.user_id ?? meBody.id ?? shortBody?.user_id ?? ''),
    account_name: meBody.username ?? null,
    access_token: longBody.access_token,
    refresh_token: null,
    expires_at: new Date(
      Date.now() + (Number(longBody.expires_in) || 60 * 24 * 3600) * 1000
    ).toISOString(),
    scopes: INSTAGRAM_SCOPES,
  };
}

async function exchangeX(
  code: string,
  verifier: string,
  creds: { id: string; secret: string }
): Promise<Connection> {
  const token = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${creds.id}:${creds.secret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
      client_id: creds.id,
    }),
  });
  const tokenBody = await readJson(token);
  if (!token.ok || !tokenBody?.access_token) {
    throw new Error(tokenBody?.error_description ?? tokenBody?.error ?? 'X did not accept the login.');
  }

  const me = await fetch('https://api.x.com/2/users/me', {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  const meBody = await readJson(me);
  if (!me.ok || !meBody?.data?.id) {
    throw new Error(meBody?.detail ?? meBody?.title ?? 'Could not read the X account.');
  }

  return {
    account_id: String(meBody.data.id),
    account_name: meBody.data.username ?? null,
    access_token: tokenBody.access_token,
    refresh_token: tokenBody.refresh_token ?? null,
    expires_at: tokenBody.expires_in
      ? new Date(Date.now() + Number(tokenBody.expires_in) * 1000).toISOString()
      : null,
    scopes: tokenBody.scope ?? X_SCOPES,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // -------------------------------------------------------------------------
  // GET — the platform sending the user back
  // -------------------------------------------------------------------------
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const state = url.searchParams.get('state');
    if (!state) return new Response('Missing state. Close this window and try again.', { status: 400 });

    const db = admin();

    // Read and delete in one statement, so a replayed callback finds nothing.
    const { data: row } = await db
      .from('oauth_states')
      .delete()
      .eq('state', state)
      .select('*')
      .maybeSingle();

    if (!row) {
      return new Response('This login has expired or was already used. Close this window and try again.', {
        status: 400,
      });
    }

    const platform = row.platform as Platform;
    const origin = row.return_origin as string;

    if (new Date(row.expires_at).getTime() < Date.now()) {
      return finish(origin, platform, 'error', 'The login took too long. Try connecting again.');
    }

    const providerError =
      url.searchParams.get('error_description') ??
      url.searchParams.get('error_reason') ??
      url.searchParams.get('error');
    if (providerError) {
      const cancelled = /denied|cancel/i.test(providerError);
      return finish(origin, platform, 'error', cancelled ? 'You cancelled the login.' : providerError);
    }

    const code = url.searchParams.get('code');
    if (!code) return finish(origin, platform, 'error', 'The platform sent back no login code.');

    const creds = credentials(platform);
    if (!creds) return finish(origin, platform, 'error', NOT_CONFIGURED[platform]);

    try {
      const connection =
        platform === 'instagram'
          ? await exchangeInstagram(code, creds)
          : await exchangeX(code, row.code_verifier ?? '', creds);

      if (!connection.account_id) throw new Error('The platform did not say which account this is.');

      const { error } = await db
        .from('social_connections')
        .upsert({ user_id: row.user_id, platform, ...connection }, { onConflict: 'user_id,platform' });
      if (error) throw new Error(error.message);

      return finish(origin, platform, 'connected');
    } catch (e) {
      return finish(origin, platform, 'error', e instanceof Error ? e.message : 'Connecting failed.');
    }
  }

  // -------------------------------------------------------------------------
  // POST — the app
  // -------------------------------------------------------------------------
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'You are signed out. Log in and try again.' }, 401);

  // The gateway is not checking the session for this function, so it is
  // checked here before anything else happens.
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ error: 'You are signed out. Log in and try again.' }, 401);

  let body: { action?: string; platform?: string; return_origin?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Malformed request.' }, 400);
  }

  const db = admin();

  if (body.action === 'status') {
    const { data: rows } = await db
      .from('social_connections')
      .select('platform, account_name')
      .eq('user_id', user.id);

    return json({
      connections: PLATFORMS.map((platform) => {
        const row = (rows ?? []).find((r) => r.platform === platform);
        return {
          platform,
          configured: credentials(platform) !== null,
          connected: Boolean(row),
          account_name: row?.account_name ?? null,
        };
      }),
    });
  }

  const platform = body.platform as Platform;
  if (!PLATFORMS.includes(platform)) return json({ error: 'Unknown platform.' }, 400);

  if (body.action === 'start') {
    const creds = credentials(platform);
    if (!creds) return json({ error: NOT_CONFIGURED[platform] }, 503);

    let origin: string;
    try {
      const parsed = new URL(String(body.return_origin ?? ''));
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
      origin = parsed.origin;
    } catch {
      return json({ error: 'Bad return address.' }, 400);
    }

    // Abandoned handshakes are swept as new ones start, so the table cannot grow
    // without bound.
    await db.from('oauth_states').delete().lt('expires_at', new Date().toISOString());

    const state = randomToken();
    const verifier = platform === 'x' ? randomToken(48) : null;

    const { error } = await db.from('oauth_states').insert({
      state,
      user_id: user.id,
      platform,
      code_verifier: verifier,
      return_origin: origin,
    });
    if (error) return json({ error: error.message }, 500);

    let authorize: URL;
    if (platform === 'instagram') {
      authorize = new URL('https://www.instagram.com/oauth/authorize');
      authorize.searchParams.set('client_id', creds.id);
      authorize.searchParams.set('redirect_uri', redirectUri());
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('scope', INSTAGRAM_SCOPES);
      authorize.searchParams.set('state', state);
    } else {
      authorize = new URL('https://x.com/i/oauth2/authorize');
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('client_id', creds.id);
      authorize.searchParams.set('redirect_uri', redirectUri());
      authorize.searchParams.set('scope', X_SCOPES);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('code_challenge', await pkceChallenge(verifier!));
      authorize.searchParams.set('code_challenge_method', 'S256');
    }

    return json({ url: authorize.toString() });
  }

  if (body.action === 'disconnect') {
    // TODO: also revoke the token at the platform, not just forget it here.
    await db.from('social_connections').delete().eq('user_id', user.id).eq('platform', platform);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action.' }, 400);
});
