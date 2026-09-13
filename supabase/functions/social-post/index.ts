// Posts a generated video to Instagram or X, as the user who connected the
// account.
//
// This is an outward, irreversible action: a post on someone's real public
// account. It only ever runs on an explicit request from the app, which shows
// the caption and waits for a confirm press first. Nothing here posts on a
// schedule, in the background, or because a model suggested it.
//
// Both platforms process video before it can go live, often for longer than a
// function may run, so this mirrors generate-video:
//
//   start — checks the video and the connection, then hands the file over: an
//           Instagram container, or an X chunked upload.
//   check — asks whether processing has finished and, when it has, publishes.
//
// A post is published at most once. Two polls can arrive together, so the move
// from "processing" to "publishing" is a conditional update: whichever request
// wins it publishes, and the other finds nothing to do.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

type Platform = 'instagram' | 'x';
const PLATFORMS: Platform[] = ['instagram', 'x'];
const LABEL: Record<Platform, string> = { instagram: 'Instagram', x: 'X' };

// Unversioned on purpose: pinning a Graph version number that does not exist
// yet, or has been retired, fails every call.
const IG_GRAPH = 'https://graph.instagram.com';
const X_API = 'https://api.x.com/2';
/** X accepts up to 5 MB per chunk; staying under leaves room for multipart overhead. */
const X_CHUNK_BYTES = 4 * 1024 * 1024;
const X_MAX_TEXT = 280;
const IG_MAX_CAPTION = 2200;
const BUCKET = 'generated-videos';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Connection = {
  id: string;
  user_id: string;
  platform: Platform;
  account_id: string;
  account_name: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};

type Post = {
  id: string;
  user_id: string;
  video_id: string;
  platform: Platform;
  caption: string;
  status: string;
  provider_ref: string | null;
};

/** A failure that retrying will not fix, as opposed to a network blip. */
class PermanentError extends Error {}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// deno-lint-ignore no-explicit-any
async function readJson(response: Response): Promise<any> {
  return await response.json().catch(() => ({}));
}

// deno-lint-ignore no-explicit-any
function platformError(body: any, fallback: string): string {
  return (
    body?.error?.error_user_msg ??
    body?.error?.message ??
    body?.detail ??
    body?.errors?.[0]?.message ??
    body?.title ??
    fallback
  );
}

async function markFailed(db: SupabaseClient, postId: string, reason: string) {
  const { data } = await db
    .from('social_posts')
    .update({ status: 'failed', error: reason })
    .eq('id', postId)
    .select('*')
    .single();
  return data;
}

/** Only one concurrent caller gets the post back; everyone else gets null. */
async function claimForPublishing(db: SupabaseClient, postId: string): Promise<Post | null> {
  const { data } = await db
    .from('social_posts')
    .update({ status: 'publishing' })
    .eq('id', postId)
    .eq('status', 'processing')
    .select('*')
    .maybeSingle();
  return data;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** Instagram tokens last 60 days; refresh when fewer than seven remain. */
async function instagramToken(db: SupabaseClient, conn: Connection): Promise<string> {
  if (!conn.expires_at) return conn.access_token;
  const remaining = new Date(conn.expires_at).getTime() - Date.now();
  if (remaining <= 0) throw new PermanentError('Your Instagram login has expired. Connect Instagram again.');
  if (remaining > 7 * 24 * 3600 * 1000) return conn.access_token;

  const url = new URL(`${IG_GRAPH}/refresh_access_token`);
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', conn.access_token);
  const res = await fetch(url);
  const body = await readJson(res);
  // Best effort: the current token is still valid, so a failed refresh is not
  // a reason to stop this post.
  if (!res.ok || !body?.access_token) return conn.access_token;

  await db
    .from('social_connections')
    .update({
      access_token: body.access_token,
      expires_at: new Date(Date.now() + (Number(body.expires_in) || 60 * 24 * 3600) * 1000).toISOString(),
    })
    .eq('id', conn.id);
  return body.access_token;
}

/** X tokens last two hours and refresh tokens rotate on every use. */
async function xToken(db: SupabaseClient, conn: Connection): Promise<string> {
  if (!conn.expires_at || new Date(conn.expires_at).getTime() - Date.now() > 60_000) {
    return conn.access_token;
  }
  if (!conn.refresh_token) throw new PermanentError('Your X login has expired. Connect X again.');

  const id = Deno.env.get('X_CLIENT_ID');
  const secret = Deno.env.get('X_CLIENT_SECRET');
  if (!id || !secret) throw new PermanentError('X posting is not set up on the server.');

  const res = await fetch(`${X_API}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
      client_id: id,
    }),
  });
  const body = await readJson(res);

  if (!res.ok || !body?.access_token) {
    // Only a rejected refresh token means the login is gone. A server error on
    // X's side is worth another try, and must not throw the connection away.
    if (res.status === 400 || res.status === 401) {
      await db.from('social_connections').delete().eq('id', conn.id);
      throw new PermanentError('Your X login has expired. Connect X again.');
    }
    throw new Error('X did not respond. Trying again shortly.');
  }

  await db
    .from('social_connections')
    .update({
      access_token: body.access_token,
      refresh_token: body.refresh_token ?? conn.refresh_token,
      expires_at: body.expires_in
        ? new Date(Date.now() + Number(body.expires_in) * 1000).toISOString()
        : null,
    })
    .eq('id', conn.id);
  return body.access_token;
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

async function publishInstagram(db: SupabaseClient, post: Post, conn: Connection, token: string) {
  const res = await fetch(`${IG_GRAPH}/${conn.account_id}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({ creation_id: post.provider_ref ?? '', access_token: token }),
  });
  const body = await readJson(res);
  if (!res.ok || !body?.id) {
    return await markFailed(db, post.id, `Instagram would not publish it: ${platformError(body, `HTTP ${res.status}`)}`);
  }

  let postUrl: string | null = null;
  try {
    const link = new URL(`${IG_GRAPH}/${body.id}`);
    link.searchParams.set('fields', 'permalink');
    link.searchParams.set('access_token', token);
    postUrl = (await readJson(await fetch(link)))?.permalink ?? null;
  } catch {
    // The post is live either way; a missing link is cosmetic.
  }

  const { data } = await db
    .from('social_posts')
    .update({ status: 'posted', provider_post_id: String(body.id), post_url: postUrl, error: null })
    .eq('id', post.id)
    .select('*')
    .single();
  return data;
}

async function publishX(db: SupabaseClient, post: Post, conn: Connection, token: string) {
  const payload: Record<string, unknown> = { media: { media_ids: [post.provider_ref] } };
  if (post.caption) payload.text = post.caption;

  const res = await fetch(`${X_API}/tweets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await readJson(res);
  const postId = body?.data?.id;
  if (!res.ok || !postId) {
    return await markFailed(db, post.id, `X would not publish it: ${platformError(body, `HTTP ${res.status}`)}`);
  }

  const { data } = await db
    .from('social_posts')
    .update({
      status: 'posted',
      provider_post_id: String(postId),
      post_url: conn.account_name
        ? `https://x.com/${conn.account_name}/status/${postId}`
        : `https://x.com/i/web/status/${postId}`,
      error: null,
    })
    .eq('id', post.id)
    .select('*')
    .single();
  return data;
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'You are signed out. Log in and try again.' }, 401);

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ error: 'You are signed out. Log in and try again.' }, 401);

  let body: { action?: string; platform?: string; video_id?: string; caption?: string; post_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Malformed request.' }, 400);
  }

  // Tokens and post rows are unreachable with the user's own client by design,
  // so those go through the service role. Every such query below is pinned to
  // the caller's user id, which came from the verified session, not the body.
  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // -------------------------------------------------------------------------
  // start
  // -------------------------------------------------------------------------
  if (body.action === 'start') {
    const platform = body.platform as Platform;
    if (!PLATFORMS.includes(platform)) return json({ error: 'Unknown platform.' }, 400);

    const caption = String(body.caption ?? '').trim();
    if (platform === 'x' && caption.length > X_MAX_TEXT) {
      return json({ error: `X allows ${X_MAX_TEXT} characters and this caption has ${caption.length}.` }, 400);
    }
    if (platform === 'instagram' && caption.length > IG_MAX_CAPTION) {
      return json({ error: `Instagram allows ${IG_MAX_CAPTION} characters and this caption has ${caption.length}.` }, 400);
    }

    // RLS: only the caller's own video can be found at all.
    const { data: video } = await userClient
      .from('videos')
      .select('id, status, storage_path')
      .eq('id', String(body.video_id ?? ''))
      .maybeSingle();
    if (!video) return json({ error: 'That video does not exist.' }, 404);
    if (video.status !== 'ready' || !video.storage_path) {
      return json({ error: 'That video has not finished generating yet.' }, 409);
    }

    const { data: conn } = await db
      .from('social_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('platform', platform)
      .maybeSingle();
    if (!conn) {
      return json({ error: `Connect ${LABEL[platform]} first.`, needs_connection: true }, 409);
    }

    const { data: post, error: insertError } = await db
      .from('social_posts')
      .insert({ user_id: user.id, video_id: video.id, platform, caption, status: 'pending' })
      .select('*')
      .single();
    if (insertError || !post) return json({ error: insertError?.message ?? 'Could not record the post.' }, 500);

    const fail = async (reason: string) =>
      json({ post: (await markFailed(db, post.id, reason)) ?? post, error: reason }, 502);

    try {
      if (platform === 'instagram') {
        const token = await instagramToken(db, conn);

        // Instagram downloads the file itself, so it needs a URL it can reach. A
        // signed link keeps the bucket private while giving Meta an hour.
        const { data: signed, error: signError } = await db.storage
          .from(BUCKET)
          .createSignedUrl(video.storage_path, 3600);
        if (signError || !signed?.signedUrl) return await fail('Could not prepare the video for Instagram.');

        const res = await fetch(`${IG_GRAPH}/${conn.account_id}/media`, {
          method: 'POST',
          body: new URLSearchParams({
            media_type: 'REELS',
            video_url: signed.signedUrl,
            caption,
            access_token: token,
          }),
        });
        const resBody = await readJson(res);
        if (!res.ok || !resBody?.id) {
          return await fail(`Instagram refused the video: ${platformError(resBody, `HTTP ${res.status}`)}`);
        }

        const { data: updated } = await db
          .from('social_posts')
          .update({ status: 'processing', provider_ref: String(resBody.id) })
          .eq('id', post.id)
          .select('*')
          .single();
        return json({ post: updated ?? post });
      }

      // X
      const token = await xToken(db, conn);

      const { data: file, error: downloadError } = await db.storage.from(BUCKET).download(video.storage_path);
      if (downloadError || !file) return await fail('Could not read the video file.');
      const bytes = new Uint8Array(await file.arrayBuffer());

      const init = await fetch(`${X_API}/media/upload/initialize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'video/mp4',
          total_bytes: bytes.byteLength,
          media_category: 'tweet_video',
        }),
      });
      const initBody = await readJson(init);
      const mediaId = initBody?.data?.id;
      if (!init.ok || !mediaId) {
        return await fail(`X refused the upload: ${platformError(initBody, `HTTP ${init.status}`)}`);
      }

      for (let offset = 0, index = 0; offset < bytes.byteLength; offset += X_CHUNK_BYTES, index++) {
        const form = new FormData();
        form.append('segment_index', String(index));
        form.append('media', new Blob([bytes.slice(offset, offset + X_CHUNK_BYTES)], { type: 'video/mp4' }));
        const append = await fetch(`${X_API}/media/upload/${mediaId}/append`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        if (!append.ok) {
          return await fail(`X stopped the upload partway: ${platformError(await readJson(append), `HTTP ${append.status}`)}`);
        }
      }

      const finalize = await fetch(`${X_API}/media/upload/${mediaId}/finalize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const finalizeBody = await readJson(finalize);
      if (!finalize.ok) {
        return await fail(`X could not finish the upload: ${platformError(finalizeBody, `HTTP ${finalize.status}`)}`);
      }

      const { data: processing } = await db
        .from('social_posts')
        .update({ status: 'processing', provider_ref: String(mediaId) })
        .eq('id', post.id)
        .select('*')
        .single();

      // Short clips can come back already processed; publish them now rather
      // than waiting for the next poll.
      const info = finalizeBody?.data?.processing_info;
      if (!info || info.state === 'succeeded') {
        const claimed = await claimForPublishing(db, post.id);
        if (claimed) return json({ post: await publishX(db, claimed, conn, token) });
      }
      return json({ post: processing ?? post });
    } catch (e) {
      return await fail(e instanceof Error ? e.message : 'Posting failed.');
    }
  }

  // -------------------------------------------------------------------------
  // check
  // -------------------------------------------------------------------------
  if (body.action === 'check') {
    const { data: post } = await db
      .from('social_posts')
      .select('*')
      .eq('id', String(body.post_id ?? ''))
      .eq('user_id', user.id)
      .maybeSingle();
    if (!post) return json({ error: 'That post does not exist.' }, 404);

    // Finished, or another request is already mid-publish on it.
    if (post.status !== 'processing') return json({ post });

    const { data: conn } = await db
      .from('social_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('platform', post.platform)
      .maybeSingle();
    if (!conn) {
      return json({ post: await markFailed(db, post.id, 'The account was disconnected before the post finished.') });
    }

    try {
      if (post.platform === 'instagram') {
        const token = await instagramToken(db, conn);
        const statusUrl = new URL(`${IG_GRAPH}/${post.provider_ref}`);
        statusUrl.searchParams.set('fields', 'status_code,status');
        statusUrl.searchParams.set('access_token', token);
        const res = await fetch(statusUrl);
        const statusBody = await readJson(res);
        if (!res.ok) return json({ post, note: platformError(statusBody, 'Could not reach Instagram. Still waiting.') });

        const code = statusBody?.status_code;
        if (code === 'IN_PROGRESS') return json({ post });
        if (code === 'FINISHED') {
          const claimed = await claimForPublishing(db, post.id);
          return json({ post: claimed ? await publishInstagram(db, claimed, conn, token) : post });
        }
        return json({
          post: await markFailed(db, post.id, `Instagram could not process the video: ${statusBody?.status ?? code ?? 'unknown error'}`),
        });
      }

      const token = await xToken(db, conn);
      const statusUrl = new URL(`${X_API}/media/upload`);
      statusUrl.searchParams.set('command', 'STATUS');
      statusUrl.searchParams.set('media_id', post.provider_ref ?? '');
      const res = await fetch(statusUrl, { headers: { Authorization: `Bearer ${token}` } });
      const statusBody = await readJson(res);
      if (!res.ok) return json({ post, note: platformError(statusBody, 'Could not reach X. Still waiting.') });

      const info = statusBody?.data?.processing_info;
      if (info?.state === 'failed') {
        return json({ post: await markFailed(db, post.id, `X could not process the video: ${info?.error?.message ?? 'unknown error'}`) });
      }
      if (info?.state && info.state !== 'succeeded') return json({ post });

      const claimed = await claimForPublishing(db, post.id);
      return json({ post: claimed ? await publishX(db, claimed, conn, token) : post });
    } catch (e) {
      if (e instanceof PermanentError) return json({ post: await markFailed(db, post.id, e.message) });
      return json({ post, note: e instanceof Error ? e.message : 'Still waiting.' });
    }
  }

  return json({ error: 'Unknown action. Use "start" or "check".' }, 400);
});
