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
  resolution: string;
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
}): Promise<{ video: GeneratedVideo }> {
  return invoke<{ video: GeneratedVideo }>({
    action: 'start',
    conversation_id: input.conversationId,
    prompt: input.prompt,
    aspect_ratio: input.aspectRatio ?? '9:16',
    duration_seconds: input.durationSeconds ?? 4,
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
export async function playbackUrl(video: GeneratedVideo): Promise<string | null> {
  if (!video.storage_path) return null;
  const { data, error } = await supabase.storage
    .from('generated-videos')
    .createSignedUrl(video.storage_path, 60 * 60);

  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Roughly what a generation costs, so the confirm step can say so. */
export function estimateCost(durationSeconds: number): string {
  // Veo 3.1 Fast is about $0.15 per second of output, audio included.
  const dollars = durationSeconds * 0.15;
  return `about $${dollars.toFixed(2)}`;
}
