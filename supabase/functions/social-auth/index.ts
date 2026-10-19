// OAuth for social platforms Synq can connect to and publish videos on.
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
import { decryptToken, encryptToken } from '../_shared/social-token-crypto.ts';
import { refreshYouTubeAccessToken, YouTubeRefreshError } from '../_shared/youtube-oauth.ts';

type Platform = 'youtube' | 'instagram' | 'x' | 'linkedin';
const PLATFORMS: Platform[] = ['youtube', 'instagram', 'x', 'linkedin'];

// Only what posting needs. Messages and comments are left out on purpose: a
// login screen asking for more than the feature uses is a reason to say no.
const INSTAGRAM_SCOPES = 'instagram_business_basic,instagram_business_content_publish';
const X_SCOPES = 'tweet.write users.read media.write offline.access';
const LINKEDIN_SCOPES = 'openid profile w_member_social';
const YOUTUBE_SCOPES = 'openid email profile https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const NOT_CONFIGURED: Record<Platform, string> = {
  youtube: 'YouTube setup is incomplete. Add YOUTUBE_GOOGLE_CONSOLE_CLIENT_ID and YOUTUBE_GOOGLE_CONSOLE_CLIENT_SECRET to Supabase Edge Function secrets.',
  instagram:
    'Instagram posting is not set up yet. Add INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET to the Supabase secrets.',
  x: 'X posting is not set up yet. Add X_CLIENT_ID and X_CLIENT_SECRET to the Supabase secrets.',
  linkedin: 'LinkedIn posting is not set up yet. Add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to the Supabase secrets.',
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
  const names = platform === 'instagram'
    ? ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET']
    : platform === 'x'
      ? ['X_CLIENT_ID', 'X_CLIENT_SECRET']
      : platform === 'linkedin'
        ? ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET']
        : ['YOUTUBE_GOOGLE_CONSOLE_CLIENT_ID', 'YOUTUBE_GOOGLE_CONSOLE_CLIENT_SECRET'];
  const id = Deno.env.get(names[0]) ?? (platform === 'youtube' ? Deno.env.get('YOUTUBE_CLIENT_ID') : null);
  const secret = Deno.env.get(names[1]) ?? (platform === 'youtube' ? Deno.env.get('YOUTUBE_CLIENT_SECRET') : null);
  return id && secret ? { id, secret } : null;
}

function missingConfiguration(platform: Platform): string[] {
  const required: [string, string[]][] = platform === 'youtube'
    ? [['YOUTUBE_GOOGLE_CONSOLE_CLIENT_ID', ['YOUTUBE_GOOGLE_CONSOLE_CLIENT_ID', 'YOUTUBE_CLIENT_ID']], ['YOUTUBE_GOOGLE_CONSOLE_CLIENT_SECRET', ['YOUTUBE_GOOGLE_CONSOLE_CLIENT_SECRET', 'YOUTUBE_CLIENT_SECRET']]]
    : platform === 'instagram'
      ? [['INSTAGRAM_APP_ID', ['INSTAGRAM_APP_ID']], ['INSTAGRAM_APP_SECRET', ['INSTAGRAM_APP_SECRET']]]
      : platform === 'x'
        ? [['X_CLIENT_ID', ['X_CLIENT_ID']], ['X_CLIENT_SECRET', ['X_CLIENT_SECRET']]]
        : [['LINKEDIN_CLIENT_ID', ['LINKEDIN_CLIENT_ID']], ['LINKEDIN_CLIENT_SECRET', ['LINKEDIN_CLIENT_SECRET']]];
  return required.filter(([, aliases]) => !aliases.some((name) => Deno.env.get(name))).map(([name]) => name);
}

/** Must match, character for character, the redirect URI registered with each platform. */
function redirectUri() {
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/social-auth`;
}

function isAllowedReturnOrigin(origin: string): boolean {
  if (origin === 'synqai://oauth-complete') return true;
  const configured = (Deno.env.get('SOCIAL_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowed = configured.length > 0
    ? configured
    : ['http://localhost:8081', 'http://localhost:8082', 'http://localhost:8083'];
  return allowed.includes(origin);
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
  const target = origin.startsWith('synqai://')
    ? new URL(origin)
    : new URL('/oauth-complete', origin);
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

async function exchangeLinkedIn(
  code: string,
  verifier: string,
  creds: { id: string; secret: string }
): Promise<Connection> {
  const token = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: creds.id,
      client_secret: creds.secret,
      code_verifier: verifier,
    }),
  });
  const tokenBody = await readJson(token);
  if (!token.ok || !tokenBody?.access_token) {
    throw new Error(tokenBody?.error_description ?? 'LinkedIn did not accept the login.');
  }

  const profile = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  const profileBody = await readJson(profile);
  if (!profile.ok || !profileBody?.sub) {
    throw new Error(profileBody?.message ?? 'Could not read the LinkedIn account.');
  }

  return {
    account_id: `urn:li:person:${String(profileBody.sub).replace(/^urn:li:person:/, '')}`,
    account_name: profileBody.name ?? profileBody.email ?? 'LinkedIn member',
    access_token: tokenBody.access_token,
    refresh_token: tokenBody.refresh_token ?? null,
    expires_at: tokenBody.expires_in
      ? new Date(Date.now() + Number(tokenBody.expires_in) * 1000).toISOString()
      : null,
    scopes: tokenBody.scope ?? LINKEDIN_SCOPES,
  };
}

async function exchangeYouTube(
  code: string,
  verifier: string,
  creds: { id: string; secret: string }
): Promise<Connection> {
  const token = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: creds.id,
      client_secret: creds.secret,
      code_verifier: verifier,
    }),
  });
  const tokenBody = await readJson(token);
  if (!token.ok || !tokenBody?.access_token) {
    throw new Error(tokenBody?.error_description ?? tokenBody?.error ?? 'Google did not accept the YouTube login.');
  }
  if (typeof tokenBody.refresh_token !== 'string' || !tokenBody.refresh_token) {
    throw new Error('Google did not issue a reusable YouTube authorization. Try connecting again and approve offline access.');
  }

  // Verify the authorization against the actual YouTube channel before marking
  // the plugin connected; an OAuth callback alone is not enough.
  const channel = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  const channelBody = await readJson(channel);
  const selected = channelBody?.items?.[0];
  if (!channel.ok || !selected?.id) {
    throw new Error(channelBody?.error?.message ?? 'Google authorized the account, but Synq could not verify a YouTube channel or the required YouTube permissions.');
  }

  return {
    account_id: String(selected.id),
    account_name: selected.snippet?.title ?? 'YouTube channel',
    access_token: tokenBody.access_token,
    refresh_token: tokenBody.refresh_token,
    expires_at: tokenBody.expires_in
      ? new Date(Date.now() + Number(tokenBody.expires_in) * 1000).toISOString()
      : null,
    scopes: tokenBody.scope ?? YOUTUBE_SCOPES,
  };
}

async function verifyConnection(platform: Platform, conn: Connection): Promise<{ ok: boolean; reconnect: boolean; error?: string }> {
  try {
    const token = conn.access_token;
    const response = platform === 'youtube'
      ? await fetch('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true', { headers: { Authorization: `Bearer ${token}` } })
      : platform === 'instagram'
        ? await fetch(`https://graph.instagram.com/me?fields=user_id&access_token=${encodeURIComponent(token)}`)
        : platform === 'x'
          ? await fetch('https://api.x.com/2/users/me', { headers: { Authorization: `Bearer ${token}` } })
          : await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${token}` } });
    const body = await readJson(response);
    if (response.ok) {
      const identity = platform === 'youtube'
        ? body?.items?.[0]?.id
        : platform === 'instagram'
          ? body?.user_id
          : platform === 'x'
            ? body?.data?.id
            : body?.sub;
      if (identity && String(identity) === conn.account_id.replace(/^urn:li:person:/, '')) return { ok: true, reconnect: false };
      return { ok: false, reconnect: true, error: 'The authorized account could not be verified. Reconnect this plugin.' };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reconnect: true, error: body?.error?.message ?? body?.detail ?? 'Authorization expired or required permissions were revoked. Reconnect this plugin.' };
    }
    return { ok: false, reconnect: false, error: `The provider could not verify this connection (HTTP ${response.status}). Try again.` };
  } catch {
    return { ok: false, reconnect: false, error: 'Could not reach the provider to verify this connection. Try again.' };
  }
}

async function refreshYouTubeConnection(db: ReturnType<typeof admin>, userId: string, conn: Connection): Promise<Connection> {
  if (!conn.refresh_token) throw new YouTubeRefreshError('The YouTube authorization has no refresh token.', true);
  const creds = credentials('youtube');
  if (!creds) throw new Error('YouTube OAuth is not configured on the server.');

  const refreshed = await refreshYouTubeAccessToken(conn.refresh_token, creds.id, creds.secret);
  const next: Connection = {
    ...conn,
    access_token: refreshed.accessToken,
    expires_at: refreshed.expiresIn ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString() : null,
  };
  const { error } = await db.from('social_connections').update({
    access_token: await encryptToken(next.access_token),
    expires_at: next.expires_at,
  }).eq('user_id', userId).eq('platform', 'youtube');
  if (error) throw new Error('Could not save the refreshed YouTube authorization.');
  return next;
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
      const verifier = (await decryptToken(row.code_verifier)) ?? '';
      const connection = platform === 'instagram'
        ? await exchangeInstagram(code, creds)
        : platform === 'x'
          ? await exchangeX(code, verifier, creds)
          : platform === 'linkedin'
            ? await exchangeLinkedIn(code, verifier, creds)
            : await exchangeYouTube(code, verifier, creds);

      if (!connection.account_id) throw new Error('The platform did not say which account this is.');

      const { error } = await db
        .from('social_connections')
        .upsert({
          user_id: row.user_id,
          platform,
          ...connection,
          access_token: await encryptToken(connection.access_token),
          refresh_token: connection.refresh_token ? await encryptToken(connection.refresh_token) : null,
        }, { onConflict: 'user_id,platform' });
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

  let body: { action?: string; platform?: string; return_origin?: string; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Malformed request.' }, 400);
  }

  const db = admin();

  if (body.action === 'status') {
    const { data: rows, error } = await db
      .from('social_connections')
      .select('platform, account_id, account_name, access_token, refresh_token, expires_at, scopes, publishing_enabled')
      .eq('user_id', user.id);
    if (error) return json({ error: 'Could not load your saved plugin connections.' }, 500);

    return json({
      connections: await Promise.all(PLATFORMS.map(async (platform) => {
        const row = (rows ?? []).find((r) => r.platform === platform);
        const missing = missingConfiguration(platform);
        if (!Deno.env.get('SOCIAL_TOKEN_ENCRYPTION_KEY')) missing.push('SOCIAL_TOKEN_ENCRYPTION_KEY');
        const configured = missing.length === 0;
        const base = {
          platform,
          configured,
          configuration_missing: missing,
          api_key_configured: platform === 'youtube' ? Boolean(Deno.env.get('YOUTUBE_API_KEY')) : undefined,
          connected: false,
          publishing_enabled: row ? row.publishing_enabled !== false : false,
          needs_reconnect: false,
          account_name: null as string | null,
          verification_error: null as string | null,
        };
        if (!row) return base;
        if (!configured) return { ...base, needs_reconnect: true, verification_error: 'Server credentials or token encryption are not configured.' };
        try {
          let connection: Connection = {
            account_id: row.account_id,
            account_name: row.account_name,
            access_token: (await decryptToken(row.access_token)) ?? '',
            refresh_token: await decryptToken(row.refresh_token),
            expires_at: row.expires_at,
            scopes: row.scopes ?? '',
          };
          if (platform === 'youtube' && connection.refresh_token && connection.expires_at && new Date(connection.expires_at).getTime() - Date.now() <= 60_000) {
            try {
              connection = await refreshYouTubeConnection(db, user.id, connection);
            } catch (error) {
              const revoked = error instanceof YouTubeRefreshError && error.permanentlyRejected;
              return {
                ...base,
                needs_reconnect: revoked,
                verification_error: revoked
                  ? 'Your YouTube authorization was revoked or expired. Reconnect YouTube.'
                  : 'Google could not refresh the YouTube login. Try again shortly.',
              };
            }
          }
          let verification = await verifyConnection(platform, connection);
          if (platform === 'youtube' && verification.reconnect && connection.refresh_token) {
            try {
              connection = await refreshYouTubeConnection(db, user.id, connection);
              verification = await verifyConnection(platform, connection);
            } catch (error) {
              const revoked = error instanceof YouTubeRefreshError && error.permanentlyRejected;
              return {
                ...base,
                needs_reconnect: revoked,
                verification_error: revoked
                  ? 'Your YouTube authorization was revoked or expired. Reconnect YouTube.'
                  : 'Google could not refresh the YouTube login. Try again shortly.',
              };
            }
          }
          return {
            ...base,
            connected: verification.ok,
            needs_reconnect: verification.reconnect,
            account_name: verification.ok ? row.account_name : null,
            verification_error: verification.error ?? null,
          };
        } catch {
          return { ...base, needs_reconnect: true, verification_error: 'The stored authorization could not be decrypted. Reconnect this plugin.' };
        }
      })),
    });
  }

  const platform = body.platform as Platform;
  if (!PLATFORMS.includes(platform)) return json({ error: 'Unknown platform.' }, 400);

  if (body.action === 'set_publishing_enabled') {
    if (platform !== 'youtube' || typeof body.enabled !== 'boolean') {
      return json({ error: 'YouTube destination settings are invalid.' }, 400);
    }
    const { data: row, error: loadError } = await db
      .from('social_connections')
      .select('id')
      .eq('user_id', user.id)
      .eq('platform', 'youtube')
      .maybeSingle();
    if (loadError) return json({ error: 'Could not update the YouTube destination.' }, 500);
    if (!row) return json({ error: 'Connect YouTube before enabling it as a publishing destination.', needs_connection: true }, 409);
    const { error: updateError } = await db.from('social_connections')
      .update({ publishing_enabled: body.enabled })
      .eq('id', row.id)
      .eq('user_id', user.id);
    if (updateError) return json({ error: 'Could not update the YouTube destination.' }, 500);
    return json({ publishing_enabled: body.enabled });
  }

  if (body.action === 'start') {
    const creds = credentials(platform);
    if (!creds) return json({ error: NOT_CONFIGURED[platform] }, 503);
    if (!Deno.env.get('SOCIAL_TOKEN_ENCRYPTION_KEY')) {
      return json({ error: 'Social account encryption is not configured on the server yet.' }, 503);
    }

    let origin: string;
    try {
      const parsed = new URL(String(body.return_origin ?? ''));
      if (parsed.protocol === 'synqai:' && parsed.hostname === 'oauth-complete') {
        origin = 'synqai://oauth-complete';
      } else if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        origin = parsed.origin;
      } else {
        throw new Error();
      }
      if (!isAllowedReturnOrigin(origin)) throw new Error();
    } catch {
      return json({ error: 'This app address is not allowed for social sign-in.' }, 400);
    }

    // Abandoned handshakes are swept as new ones start, so the table cannot grow
    // without bound.
    await db.from('oauth_states').delete().lt('expires_at', new Date().toISOString());

    const state = randomToken();
    const verifier = platform === 'instagram' ? null : randomToken(48);

    const { error } = await db.from('oauth_states').insert({
      state,
      user_id: user.id,
      platform,
      code_verifier: verifier ? await encryptToken(verifier) : null,
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
    } else if (platform === 'x') {
      authorize = new URL('https://x.com/i/oauth2/authorize');
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('client_id', creds.id);
      authorize.searchParams.set('redirect_uri', redirectUri());
      authorize.searchParams.set('scope', X_SCOPES);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('code_challenge', await pkceChallenge(verifier!));
      authorize.searchParams.set('code_challenge_method', 'S256');
    } else if (platform === 'linkedin') {
      authorize = new URL('https://www.linkedin.com/oauth/v2/authorization');
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('client_id', creds.id);
      authorize.searchParams.set('redirect_uri', redirectUri());
      authorize.searchParams.set('scope', LINKEDIN_SCOPES);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('code_challenge', await pkceChallenge(verifier!));
      authorize.searchParams.set('code_challenge_method', 'S256');
    } else {
      authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('client_id', creds.id);
      authorize.searchParams.set('redirect_uri', redirectUri());
      authorize.searchParams.set('scope', YOUTUBE_SCOPES);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('access_type', 'offline');
      authorize.searchParams.set('prompt', 'consent');
      authorize.searchParams.set('include_granted_scopes', 'true');
      authorize.searchParams.set('code_challenge', await pkceChallenge(verifier!));
      authorize.searchParams.set('code_challenge_method', 'S256');
    }

    return json({ url: authorize.toString() });
  }

  if (body.action === 'disconnect') {
    // Unlink only inside Synq. Keep the provider authorization intact.
    await db.from('social_connections').delete().eq('user_id', user.id).eq('platform', platform);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action.' }, 400);
});
