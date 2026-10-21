import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { supabase } from '@/lib/supabase';
import { notifyAnalyticsChanged } from '@/lib/analytics-events';

// Video generation from the client's side. The provider, the key and the file
// download all stay on the server; this only starts jobs, asks how they are
// going, and turns a finished one into a URL that can be played.

export type VideoStatus = 'pending' | 'generating' | 'ready' | 'failed';

export type GeneratedVideo = {
  id: string;
  user_id: string;
  conversation_id: string;
  prompt: string;
  aspect_ratio: '16:9' | '9:16';
  duration_seconds: number;
  resolution: '720p' | '1080p' | '4k';
  status: VideoStatus;
  operation_name: string | null;
  storage_path: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export class VideoError extends Error {}

/** Digs the real message out of supabase-js's generic non-2xx error. */
async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('generate-video', { body });

  if (error) {
    const response = (error as { context?: Response }).context;
    if (response && typeof response.json === 'function') {
      try {
        const parsed = await response.json();
        if (parsed?.error) throw new VideoError(parsed.error);
      } catch (e) {
        if (e instanceof VideoError) throw e;
      }
    }
    throw new VideoError(error.message || 'That did not go through. Try again.');
  }

  return data as T;
}

export function startVideo(input: {
  conversationId: string;
  prompt: string;
  aspectRatio?: '16:9' | '9:16';
  durationSeconds?: number;
  resolution?: '720p' | '1080p' | '4k';
}): Promise<{ video: GeneratedVideo }> {
  return invoke<{ video: GeneratedVideo }>({
    action: 'start',
    conversation_id: input.conversationId,
    prompt: input.prompt,
    aspect_ratio: input.aspectRatio ?? '9:16',
    duration_seconds: input.durationSeconds ?? 4,
    resolution: input.resolution ?? '720p',
  }).then((result) => {
    notifyAnalyticsChanged();
    return result;
  });
}

export async function checkVideo(videoId: string): Promise<{ video: GeneratedVideo; note?: string }> {
  const result = await invoke<{ video: GeneratedVideo; note?: string }>({ action: 'check', video_id: videoId });
  if (result.video.status === 'ready' || result.video.status === 'failed') notifyAnalyticsChanged();
  return result;
}

export async function listVideos(conversationId: string): Promise<GeneratedVideo[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw new VideoError(error.message);
  return (data ?? []) as GeneratedVideo[];
}

/**
 * The bucket is private, so playback goes through a short-lived signed URL
 * rather than a permanent public link. An unreleased marketing draft should not
 * be watchable by anyone who guesses the path.
 */
export async function playbackUrl(storagePath: string | null): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage
    .from('generated-videos')
    .createSignedUrl(storagePath, 60 * 60);

  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Download to the browser, or save locally and open the native share sheet. */
export async function downloadVideo(video: GeneratedVideo): Promise<void> {
  const url = await playbackUrl(video.storage_path);
  if (!url) throw new VideoError('Could not prepare a secure download link. Try again.');

  const filename = `synq-video-${video.id}.mp4`;
  if (Platform.OS === 'web') {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }

  const file = await File.downloadFileAsync(url, new File(Paths.cache, filename), { idempotent: true });
  if (!(await Sharing.isAvailableAsync())) {
    throw new VideoError('This device cannot open the save/share menu.');
  }
  await Sharing.shareAsync(file.uri, { dialogTitle: 'Save or share your Synq video', mimeType: 'video/mp4', UTI: 'public.movie' });
}

/** Estimate Seedance 2.0 cost using fal's published rates; final billing is controlled by fal.ai. */
export function estimateCost(durationSeconds: number, resolution: '720p' = '720p'): string {
  // fal's current Seedance 2.0 720p pricing combines $0.3034/s and
  // $0.014 per 1,000 generated tokens (720 × 1280 × seconds × 24 / 1024).
  const tokensPerSecond = (720 * 1280 * 24) / 1024;
  const dollars = durationSeconds * (0.3034 + (tokensPerSecond / 1000) * 0.014);
  return `about $${dollars.toFixed(2)}`;
}
