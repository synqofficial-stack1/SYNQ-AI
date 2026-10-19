export const MARKETING_UPLOAD_LIMIT = 100 * 1024 * 1024;
export const MARKETING_VIDEO_TYPE = 'video/mp4';
export const MARKETING_CAPTION_LIMITS = { youtube: 5000, instagram: 2200, x: 280, linkedin: 3000 } as const;
export const MARKETING_DURATION_LIMITS_SECONDS = { youtube: 900, instagram: 900, x: 140, linkedin: 1800 } as const;
export type MarketingPlatform = keyof typeof MARKETING_CAPTION_LIMITS;

export function validateMarketingVideo(name: string, mimeType: string | null | undefined, size: number | null | undefined): string | null {
  if (mimeType !== MARKETING_VIDEO_TYPE && !name.toLowerCase().endsWith('.mp4')) return 'Choose an MP4 video. Other formats are not accepted by the current publishing pipeline.';
  if (!size || size <= 0) return 'The selected video is empty or its size could not be read.';
  if (size > MARKETING_UPLOAD_LIMIT) return 'Video must be under 100 MB.';
  return null;
}

export function composeMarketingCaption(caption: string, hashtags: string): string {
  return [caption.trim(), hashtags.trim()].filter(Boolean).join('\n\n');
}

export function validateMarketingCaption(platform: MarketingPlatform, caption: string, hashtags: string): string | null {
  const text = composeMarketingCaption(caption, hashtags);
  return text.length > MARKETING_CAPTION_LIMITS[platform]
    ? `${platform} allows ${MARKETING_CAPTION_LIMITS[platform]} characters including hashtags.`
    : null;
}

export function validateMarketingDuration(platform: MarketingPlatform, durationSeconds: number | null | undefined): string | null {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return 'Wait for the video duration to load before review.';
  if ((platform === 'instagram' || platform === 'linkedin') && durationSeconds < 3) return `${platform} videos must be at least 3 seconds.`;
  if (durationSeconds > MARKETING_DURATION_LIMITS_SECONDS[platform]) {
    const label = platform === 'x' ? 'X (standard video posts)' : platform === 'youtube' ? 'YouTube (unverified upload limit)' : platform === 'instagram' ? 'Instagram Reels' : 'LinkedIn';
    return `This video exceeds the ${label} publishing limit (${Math.floor(MARKETING_DURATION_LIMITS_SECONDS[platform] / 60)} minutes${MARKETING_DURATION_LIMITS_SECONDS[platform] % 60 ? ` ${MARKETING_DURATION_LIMITS_SECONDS[platform] % 60} seconds` : ''}).`;
  }
  return null;
}
