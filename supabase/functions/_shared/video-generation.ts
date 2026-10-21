export const FAL_VIDEO_MODEL = 'bytedance/seedance-2.0/text-to-video';

export type VideoResolution = '720p';

export type VideoOptions = {
  aspectRatio: '16:9' | '9:16';
  durationSeconds: number;
  resolution: VideoResolution;
};

export function parseVideoOptions(input: {
  aspect_ratio?: unknown;
  duration_seconds?: unknown;
  resolution?: unknown;
}): { options: VideoOptions } | { error: string } {
  const aspectRatio = input.aspect_ratio === '16:9' ? '16:9' : '9:16';
  const durationSeconds = Number(input.duration_seconds ?? 4);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 4 || durationSeconds > 15) {
    return { error: 'Choose a supported video length between 4 and 15 seconds.' };
  }

  if (input.resolution !== undefined && input.resolution !== '720p') {
    return { error: 'Seedance 2.0 text-to-video currently supports 720p output only.' };
  }
  const resolution: VideoResolution = '720p';

  return { options: { aspectRatio, durationSeconds, resolution } };
}

/** Seedance's API accepts duration as an enum string, not a JSON number. */
export function buildFalInput(prompt: string, options: VideoOptions, endUserId: string) {
  return {
    prompt,
    resolution: options.resolution,
    duration: String(options.durationSeconds),
    aspect_ratio: options.aspectRatio,
    generate_audio: true,
    end_user_id: endUserId,
  };
}
