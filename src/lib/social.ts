import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { notifyAnalyticsChanged } from '@/lib/analytics-events';
import { supabase } from '@/lib/supabase';

// Connecting and posting to Instagram and X, from the client's side.
//
// The client never holds a token. It asks social-auth what is connected, then
// sends the user through the platform's authorization flow. YouTube uses a
// full-page redirect on web; other web providers use the existing popup flow.
// Posting goes through social-post, which uploads and publishes on the server.
//
// Completion is reported over a BroadcastChannel rather than window.opener. The
// Instagram and X login pages isolate themselves from the window that opened
// them, which severs `opener` and makes the popup look closed long before it
// is. A same-origin channel is not affected by either.

export type SocialPlatform = 'youtube' | 'instagram' | 'x' | 'linkedin';

// LinkedIn stays in the underlying types so existing connection records remain
// readable, but it is no longer offered for new connections or publishing.
export const SOCIAL_PLATFORMS: SocialPlatform[] = ['youtube', 'instagram', 'x'];

export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  x: 'X',
  linkedin: 'LinkedIn',
};

export const CAPTION_LIMITS: Record<SocialPlatform, number> = {
  youtube: 5000,
  instagram: 2200,
  x: 280,
  linkedin: 3000,
};

export type Connection = {
  platform: SocialPlatform;
  /** False until the platform's app keys are in the Supabase secrets. */
  configured: boolean;
  connected: boolean;
  /** Whether Synq may use this authorized account as a publishing destination. */
  publishing_enabled: boolean;
  needs_reconnect?: boolean;
  verification_error?: string | null;
  configuration_missing?: string[];
  api_key_configured?: boolean;
  account_name: string | null;
};

export type PostStatus = 'pending' | 'processing' | 'publishing' | 'posted' | 'failed';

export type SocialPost = {
  id: string;
  user_id: string;
  video_id: string | null;
  media_id?: string | null;
  draft_id?: string | null;
  title?: string;
  description?: string;
  youtube_visibility?: 'public' | 'unlisted' | 'private';
  platform: SocialPlatform;
  caption: string;
  status: PostStatus;
  provider_ref: string | null;
  provider_post_id: string | null;
  post_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export const OAUTH_CHANNEL = 'synq-oauth';

export type OAuthMessage = {
  platform: string;
  status: 'connected' | 'error';
  message?: string;
};

export class SocialError extends Error {
  constructor(
    message: string,
    readonly needsConnection = false
  ) {
    super(message);
  }
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const STATUS_POLL_MS = 3000;

/** Digs the real message out of supabase-js's generic non-2xx error. */
async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });

  if (error) {
    const response = (error as { context?: Response }).context;
    if (response && typeof response.json === 'function') {
      try {
        const parsed = await response.json();
        if (parsed?.error) throw new SocialError(parsed.error, Boolean(parsed.needs_connection));
      } catch (e) {
        if (e instanceof SocialError) throw e;
      }
    }
    throw new SocialError(error.message || 'That did not go through. Try again.');
  }

  return data as T;
}

export async function loadConnections(): Promise<Connection[]> {
  const { connections } = await invoke<{ connections: Connection[] }>('social-auth', {
    action: 'status',
  });
  return connections;
}

export async function disconnectPlatform(platform: SocialPlatform): Promise<void> {
  await invoke('social-auth', { action: 'disconnect', platform });
}

export async function setPublishingEnabled(platform: SocialPlatform, enabled: boolean): Promise<void> {
  await invoke('social-auth', { action: 'set_publishing_enabled', platform, enabled });
}

/**
 * Starts the platform's login and resolves once it is connected.
 *
 * YouTube and Instagram navigate the current web page to the provider and
 * return to Synq. This avoids popup blockers. X and LinkedIn retain their
 * existing popup flow and BroadcastChannel completion handling.
 */
export async function connectPlatform(platform: SocialPlatform): Promise<void> {
  const returnUrl = Platform.OS === 'web' ? window.location.origin : Linking.createURL('oauth-complete');
  const fullPage = Platform.OS === 'web' && (platform === 'youtube' || platform === 'instagram');
  const popup = Platform.OS === 'web' && !fullPage ? window.open('', 'synq-oauth', 'width=520,height=720') : null;
  if (Platform.OS === 'web' && !fullPage && !popup) {
    throw new SocialError('Your browser blocked the login window. Allow popups for Synq and try again.');
  }

  let url: string;
  try {
    ({ url } = await invoke<{ url: string }>('social-auth', {
      action: 'start',
      platform,
      return_origin: returnUrl,
    }));
  } catch (e) {
    popup?.close();
    throw e;
  }

  if (fullPage) {
    window.location.assign(url);
    return;
  }

  if (Platform.OS !== 'web') {
    const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
    if (result.type !== 'success' || !result.url) {
      throw new SocialError(result.type === 'cancel' ? 'You cancelled the login.' : 'The login did not complete.');
    }
    const callback = new URL(result.url);
    if (callback.searchParams.get('status') !== 'connected') {
      throw new SocialError(callback.searchParams.get('message') || 'Connecting failed.');
    }
    return;
  }

  popup!.location.href = url;

  await new Promise<void>((resolve, reject) => {
    const channel = new BroadcastChannel(OAUTH_CHANNEL);
    let settled = false;

    const settle = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      channel.close();
      clearInterval(poll);
      clearTimeout(timeout);
      outcome();
    };

    channel.onmessage = (event: MessageEvent<OAuthMessage>) => {
      if (event.data?.platform !== platform) return;
      settle(() =>
        event.data.status === 'connected'
          ? resolve()
          : reject(new SocialError(event.data.message || 'Connecting failed.'))
      );
    };

    // Belt and braces: if the completion page never gets to report, the stored
    // connection is still the truth.
    const poll = setInterval(async () => {
      try {
        const list = await loadConnections();
        if (list.find((c) => c.platform === platform)?.connected) settle(resolve);
      } catch {
        // Try again next tick.
      }
    }, STATUS_POLL_MS);

    const timeout = setTimeout(
      () => settle(() => reject(new SocialError('The login took too long. Try again.'))),
      LOGIN_TIMEOUT_MS
    );
  });
}

export function startPost(input: {
  videoId?: string;
  mediaId?: string;
  draftId?: string;
  title?: string;
  description?: string;
  youtubeVisibility?: 'public' | 'unlisted' | 'private';
  platform: SocialPlatform;
  caption: string;
}): Promise<{ post: SocialPost }> {
  return invoke<{ post: SocialPost }>('social-post', {
    action: 'start',
    ...(input.videoId ? { video_id: input.videoId } : {}),
    ...(input.mediaId ? { media_id: input.mediaId } : {}),
    ...(input.draftId ? { draft_id: input.draftId } : {}),
    title: input.title ?? '',
    description: input.description ?? '',
    youtube_visibility: input.youtubeVisibility ?? 'public',
    platform: input.platform,
    caption: input.caption,
  }).then((result) => {
    notifyAnalyticsChanged();
    return result;
  });
}

export function checkPost(postId: string): Promise<{ post: SocialPost; note?: string }> {
  return invoke<{ post: SocialPost; note?: string }>('social-post', {
    action: 'check',
    post_id: postId,
  }).then((result) => {
    if (result.post.status === 'posted' || result.post.status === 'failed') notifyAnalyticsChanged();
    return result;
  });
}

export async function listPosts(videoId: string): Promise<SocialPost[]> {
  const { data, error } = await supabase
    .from('social_posts')
    .select('*')
    .eq('video_id', videoId)
    .order('created_at', { ascending: true });

  if (error) throw new SocialError(error.message);
  return (data ?? []) as SocialPost[];
}
