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
import { decryptToken, encryptToken } from '../_shared/social-token-crypto.ts';
import { canPublishYouTube, confirmedYouTubeVideoId, refreshYouTubeAccessToken, YouTubeRefreshError } from '../_shared/youtube-oauth.ts';

type Platform = 'youtube' | 'instagram' | 'x' | 'linkedin';
const PLATFORMS: Platform[] = ['youtube', 'instagram', 'x', 'linkedin'];
const LABEL: Record<Platform, string> = { youtube: 'YouTube', instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn' };

// Unversioned on purpose: pinning a Graph version number that does not exist
// yet, or has been retired, fails every call.
const IG_GRAPH = 'https://graph.instagram.com';
const X_API = 'https://api.x.com/2';
const LINKEDIN_API = 'https://api.linkedin.com/rest';
const LINKEDIN_VERSION = '202609';
/** X accepts up to 5 MB per chunk; staying under leaves room for multipart overhead. */
const X_CHUNK_BYTES = 4 * 1024 * 1024;
const X_MAX_TEXT = 280;
const IG_MAX_CAPTION = 2200;
const LINKEDIN_MAX_TEXT = 3000;
const YOUTUBE_MAX_DESCRIPTION = 5000;
const BUCKET = 'generated-videos';
const UPLOAD_BUCKET = 'marketing-uploads';

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
  publishing_enabled?: boolean;
};

type Post = {
  id: string;
  user_id: string;
  video_id: string | null;
  media_id: string | null;
  title: string;
  description: string;
  youtube_visibility: 'public' | 'unlisted' | 'private';
  platform: Platform;
  caption: string;
  status: string;
  provider_ref: string | null;
};

/** A failure that retrying will not fix, as opposed to a network blip. */
class PermanentError extends Error {}

async function decryptConnection<T extends { access_token: string; refresh_token: string | null }>(
  connection: T
): Promise<T> {
  return {
    ...connection,
    access_token: (await decryptToken(connection.access_token)) ?? '',
    refresh_token: await decryptToken(connection.refresh_token),
  };
}

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
      access_token: await encryptToken(body.access_token),
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
      access_token: await encryptToken(body.access_token),
      refresh_token: body.refresh_token
        ? await encryptToken(body.refresh_token)
        : await encryptToken(conn.refresh_token),
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

/** YouTube access tokens are short lived; refresh tokens are kept encrypted. */
async function youtubeToken(db: SupabaseClient, conn: Connection): Promise<string> {
  if (!conn.expires_at || new Date(conn.expires_at).getTime() - Date.now() > 60_000) return conn.access_token;
  if (!conn.refresh_token) throw new PermanentError('Your YouTube login has expired. Connect YouTube again.');

  const clientId = Deno.env.get('YOUTUBE_GOOGLE_CONSOLE_CLIENT_ID') ?? Deno.env.get('YOUTUBE_CLIENT_ID');
  const clientSecret = Deno.env.get('YOUTUBE_GOOGLE_CONSOLE_CLIENT_SECRET') ?? Deno.env.get('YOUTUBE_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new PermanentError('YouTube OAuth is not configured on the server.');

  let refreshed: { accessToken: string; expiresIn: number | null };
  try {
    refreshed = await refreshYouTubeAccessToken(conn.refresh_token, clientId, clientSecret);
  } catch (error) {
    if (error instanceof YouTubeRefreshError && error.permanentlyRejected) {
      await db.from('social_connections').delete().eq('id', conn.id);
      throw new PermanentError('Your YouTube authorization was revoked or expired. Connect YouTube again.');
    }
    throw new Error('Google could not refresh the YouTube login. Try again shortly.');
  }

  await db.from('social_connections').update({
    access_token: await encryptToken(refreshed.accessToken),
    expires_at: refreshed.expiresIn ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString() : null,
  }).eq('id', conn.id);
  return refreshed.accessToken;
}

async function publishLinkedIn(db: SupabaseClient, post: Post, conn: Connection, token: string) {
  const res = await fetch(`${LINKEDIN_API}/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Linkedin-Version': LINKEDIN_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: conn.account_id,
      commentary: post.caption,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      content: { media: { title: post.title || 'Synq marketing video', id: post.provider_ref } },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  });
  const body = await readJson(res);
  const postId = res.headers.get('x-restli-id') ?? body?.id;
  if (!res.ok || !postId) {
    return await markFailed(db, post.id, `LinkedIn would not publish it: ${platformError(body, `HTTP ${res.status}`)}`);
  }

  const encodedId = encodeURIComponent(String(postId));
  const { data } = await db
    .from('social_posts')
    .update({
      status: 'posted',
      provider_post_id: String(postId),
      post_url: `https://www.linkedin.com/feed/update/${encodedId}`,
      error: null,
    })
    .eq('id', post.id)
    .select('*')
    .single();
  return data;
}

async function publishYouTube(db: SupabaseClient, post: Post, conn: Connection, token: string, file: Blob) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const title = (post.title.trim() || post.caption.trim().split(/\r?\n/)[0] || 'New video from Synq').slice(0, 100);
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(bytes.byteLength),
    },
    body: JSON.stringify({
      snippet: { title, description: post.description.trim() || post.caption, categoryId: '22' },
      status: { privacyStatus: post.youtube_visibility || 'public', selfDeclaredMadeForKids: false },
    }),
  });
  if (!init.ok) return await markFailed(db, post.id, `YouTube refused the upload setup: ${platformError(await readJson(init), `HTTP ${init.status}`)}`);
  const uploadUrl = init.headers.get('Location');
  if (!uploadUrl) return await markFailed(db, post.id, 'YouTube did not return a resumable upload URL.');

  const uploaded = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'video/mp4' },
    body: bytes,
  });
  const body = await readJson(uploaded);
  const videoId = confirmedYouTubeVideoId(uploaded.ok, body);
  if (!videoId) {
    return await markFailed(db, post.id, `YouTube could not finish the upload: ${platformError(body, `HTTP ${uploaded.status}`)}`);
  }
  const { data } = await db.from('social_posts').update({
    status: 'posted',
    provider_ref: String(videoId),
    provider_post_id: String(videoId),
    post_url: `https://www.youtube.com/watch?v=${encodeURIComponent(String(videoId))}`,
    error: null,
  }).eq('id', post.id).select('*').single();
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

  let body: { action?: string; platform?: string; video_id?: string; media_id?: string; draft_id?: string; title?: string; description?: string; youtube_visibility?: 'public' | 'unlisted' | 'private'; caption?: string; post_id?: string };
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

    let caption = String(body.caption ?? '').trim();
    let title = String(body.title ?? '').trim().slice(0, 100);
    let description = String(body.description ?? '').slice(0, 5000);
    let youtubeVisibility = body.youtube_visibility ?? 'public';
    if (platform === 'x' && caption.length > X_MAX_TEXT) {
      return json({ error: `X allows ${X_MAX_TEXT} characters and this caption has ${caption.length}.` }, 400);
    }
    if (platform === 'instagram' && caption.length > IG_MAX_CAPTION) {
      return json({ error: `Instagram allows ${IG_MAX_CAPTION} characters and this caption has ${caption.length}.` }, 400);
    }
    if (platform === 'linkedin' && caption.length > LINKEDIN_MAX_TEXT) {
      return json({ error: `LinkedIn allows ${LINKEDIN_MAX_TEXT} characters and this caption has ${caption.length}.` }, 400);
    }
    if (platform === 'youtube' && caption.length > YOUTUBE_MAX_DESCRIPTION) {
      return json({ error: `YouTube descriptions allow ${YOUTUBE_MAX_DESCRIPTION} characters and this caption has ${caption.length}.` }, 400);
    }

    // Generated videos remain supported. Uploaded videos are looked up through
    // the caller's RLS session, never by trusting a client supplied owner id.
    let videoId: string | null = null;
    let mediaId: string | null = null;
    let storagePath: string | null = null;
    let storageBucket = BUCKET;
    if (body.media_id) {
      const { data: media } = await userClient.from('marketing_media')
        .select('id, status, storage_path, content_type, size_bytes, duration_seconds')
        .eq('id', body.media_id).maybeSingle();
      if (!media) return json({ error: 'That uploaded video does not exist.' }, 404);
      if (media.status !== 'uploaded' || media.content_type !== 'video/mp4' || Number(media.size_bytes) > 104857600) {
        return json({ error: 'That uploaded video is not ready or is not a supported MP4.' }, 409);
      }
      const duration = Number(media.duration_seconds);
      if (!Number.isFinite(duration) || duration <= 0) return json({ error: 'Wait for the video duration to be read before publishing.' }, 409);
      const maximum = platform === 'x' ? 140 : platform === 'linkedin' ? 1800 : 900;
      if ((platform === 'instagram' || platform === 'linkedin') && duration < 3) return json({ error: `${LABEL[platform]} videos must be at least 3 seconds.` }, 400);
      if (duration > maximum) return json({ error: `This video exceeds ${LABEL[platform]}'s supported publishing duration for this account/API flow.` }, 400);
      mediaId = media.id;
      storagePath = media.storage_path;
      storageBucket = UPLOAD_BUCKET;
    } else {
      const { data: video } = await userClient.from('videos')
        .select('id, status, storage_path').eq('id', String(body.video_id ?? '')).maybeSingle();
      if (!video) return json({ error: 'That video does not exist.' }, 404);
      if (video.status !== 'ready' || !video.storage_path) {
        return json({ error: 'That video has not finished generating yet.' }, 409);
      }
      videoId = video.id;
      storagePath = video.storage_path;
    }
    if (!storagePath) return json({ error: 'The video file is unavailable.' }, 409);

    let retryPostId: string | null = null;
    if (body.draft_id) {
      const { data: draft } = await userClient.from('marketing_post_drafts').select('id, media_id, platforms, status, title, description, caption, hashtags, platform_content, youtube_visibility')
        .eq('id', body.draft_id).maybeSingle();
      if (!draft || !mediaId || draft.media_id !== mediaId || !draft.platforms.includes(platform) || draft.status !== 'ready_for_review') {
        return json({ error: 'Save this draft for review with this destination before publishing.' }, 409);
      }
      const { data: prior } = await db.from('social_posts').select('*').eq('draft_id', draft.id).eq('platform', platform).maybeSingle();
      if (prior && prior.status !== 'failed') return json({ post: prior });
      if (prior?.status === 'failed') {
        if (prior.provider_post_id) return json({ error: 'This destination already has a published result and cannot be retried.' }, 409);
        retryPostId = prior.id;
      }
      title = String(draft.title ?? '').trim().slice(0, 100);
      description = String(draft.description ?? '').slice(0, 5000);
      youtubeVisibility = draft.youtube_visibility;
      const platformContent = draft.platform_content && typeof draft.platform_content === 'object'
        ? String(draft.platform_content[platform] ?? draft.caption ?? '') : String(draft.caption ?? '');
      caption = [platformContent, String(draft.hashtags ?? '').trim()].filter(Boolean).join('\n\n').trim();
    }
    if (platform === 'x' && caption.length > X_MAX_TEXT) return json({ error: `X allows ${X_MAX_TEXT} characters and this caption has ${caption.length}.` }, 400);
    if (platform === 'instagram' && caption.length > IG_MAX_CAPTION) return json({ error: `Instagram allows ${IG_MAX_CAPTION} characters and this caption has ${caption.length}.` }, 400);
    if (platform === 'linkedin' && caption.length > LINKEDIN_MAX_TEXT) return json({ error: `LinkedIn allows ${LINKEDIN_MAX_TEXT} characters and this caption has ${caption.length}.` }, 400);
    if (platform === 'youtube' && caption.length > YOUTUBE_MAX_DESCRIPTION) return json({ error: `YouTube descriptions allow ${YOUTUBE_MAX_DESCRIPTION} characters and this caption has ${caption.length}.` }, 400);

    const { data: storedConnection } = await db
      .from('social_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('platform', platform)
      .maybeSingle();
    const conn = storedConnection ? await decryptConnection(storedConnection) : null;
    if (!conn) {
      return json({ error: `Connect ${LABEL[platform]} first.`, needs_connection: true }, 409);
    }
    if (platform === 'youtube' && !canPublishYouTube(storedConnection, user.id)) {
      return json({ error: 'YouTube is connected but disabled as a publishing destination. Enable it in Integrations before publishing.' }, 409);
    }

    const postQuery = retryPostId
      ? db.from('social_posts').update({ status: 'pending', title,
        description, youtube_visibility: youtubeVisibility, caption, provider_ref: null, error: null }).eq('id', retryPostId)
      : db.from('social_posts').insert({ user_id: user.id, video_id: videoId, media_id: mediaId, draft_id: body.draft_id ?? null,
        title, description, youtube_visibility: youtubeVisibility, platform, caption, status: 'pending' });
    const { data: post, error: insertError } = await postQuery.select('*').single();
    if (insertError || !post) return json({ error: insertError?.message ?? 'Could not record the post.' }, 500);

    const fail = async (reason: string) =>
      json({ post: (await markFailed(db, post.id, reason)) ?? post, error: reason }, 502);

    try {
      if (platform === 'instagram') {
        const token = await instagramToken(db, conn);

        // Instagram downloads the file itself, so it needs a URL it can reach. A
        // signed link keeps the bucket private while giving Meta an hour.
        const { data: signed, error: signError } = await db.storage
          .from(storageBucket)
          .createSignedUrl(storagePath, 3600);
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

      if (platform === 'x') {
      // X
      const token = await xToken(db, conn);

      const { data: file, error: downloadError } = await db.storage.from(storageBucket).download(storagePath);
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
      }

      if (platform === 'youtube') {
        const token = await youtubeToken(db, conn);
        const { data: file, error: downloadError } = await db.storage.from(storageBucket).download(storagePath);
        if (downloadError || !file) return await fail('Could not read the video file.');
        const result = await publishYouTube(db, post, conn, token, file);
        if (!result || result.status === 'failed') return json({ post: result ?? post });
        return json({ post: result });
      }

      // LinkedIn accepts video uploads directly from the server. The upload
      // URL is one-time and short-lived; the resulting video URN is polled
      // before creating the public post.
      const { data: file, error: downloadError } = await db.storage
        .from(storageBucket)
        .download(storagePath);
      if (downloadError || !file) return await fail('Could not read the video file.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const headers = {
        Authorization: `Bearer ${conn.access_token}`,
        'Linkedin-Version': LINKEDIN_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      };
      const initialized = await fetch(`${LINKEDIN_API}/videos?action=initializeUpload`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          initializeUploadRequest: {
            owner: conn.account_id,
            fileSizeBytes: bytes.byteLength,
            uploadCaptions: false,
            uploadThumbnail: false,
          },
        }),
      });
      const initBody = await readJson(initialized);
      const videoUrn = initBody?.value?.video;
      const instructions = initBody?.value?.uploadInstructions ?? [];
      if (!initialized.ok || !videoUrn || instructions.length === 0) {
        return await fail(`LinkedIn refused the upload: ${platformError(initBody, `HTTP ${initialized.status}`)}`);
      }

      const uploadedPartIds: string[] = [];
      for (const instruction of instructions) {
        const first = Number(instruction.firstByte);
        const last = Number(instruction.lastByte);
        if (!instruction.uploadUrl || !Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last >= bytes.byteLength) {
          return await fail('LinkedIn returned an invalid video upload range.');
        }
        const uploaded = await fetch(instruction.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: bytes.slice(first, last + 1),
        });
        const etag = uploaded.headers.get('etag');
        if (!uploaded.ok || !etag) {
          return await fail(`LinkedIn could not receive the video part: HTTP ${uploaded.status}.`);
        }
        uploadedPartIds.push(etag.replace(/^"|"$/g, ''));
      }

      const finalized = await fetch(`${LINKEDIN_API}/videos?action=finalizeUpload`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          finalizeUploadRequest: {
            video: videoUrn,
            uploadToken: initBody?.value?.uploadToken ?? '',
            uploadedPartIds,
          },
        }),
      });
      const finalizeBody = await readJson(finalized);
      if (!finalized.ok) {
        return await fail(`LinkedIn could not finish the upload: ${platformError(finalizeBody, `HTTP ${finalized.status}`)}`);
      }
      const { data: processing } = await db
        .from('social_posts')
        .update({ status: 'processing', provider_ref: String(videoUrn) })
        .eq('id', post.id)
        .select('*')
        .single();
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

    const { data: storedConnection } = await db
      .from('social_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('platform', post.platform)
      .maybeSingle();
    const conn = storedConnection ? await decryptConnection(storedConnection) : null;
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

      const token = post.platform === 'x' ? await xToken(db, conn) : conn.access_token;
      if (post.platform === 'linkedin') {
        const res = await fetch(`${LINKEDIN_API}/videos/${encodeURIComponent(post.provider_ref ?? '')}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Linkedin-Version': LINKEDIN_VERSION,
            'X-Restli-Protocol-Version': '2.0.0',
          },
        });
        const videoBody = await readJson(res);
        if (!res.ok) return json({ post, note: platformError(videoBody, 'Could not reach LinkedIn. Still waiting.') });
        if (videoBody?.status === 'PROCESSING_FAILED' || videoBody?.status === 'UPLOAD_FAILED') {
          return json({ post: await markFailed(db, post.id, `LinkedIn could not process the video: ${videoBody.status}.`) });
        }
        if (videoBody?.status !== 'AVAILABLE') return json({ post });
        const claimed = await claimForPublishing(db, post.id);
        return json({ post: claimed ? await publishLinkedIn(db, claimed, conn, token) : post });
      }

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
