import { supabase } from '@/lib/supabase';
import { notifyAnalyticsChanged } from '@/lib/analytics-events';
import type { SocialPlatform, SocialPost } from '@/lib/social';
import { MARKETING_UPLOAD_LIMIT, MARKETING_VIDEO_TYPE } from '@/lib/marketing-validation';

export const UPLOAD_LIMIT_BYTES = MARKETING_UPLOAD_LIMIT;
export const VIDEO_MIME = MARKETING_VIDEO_TYPE;
export type MarketingMedia = {
  id: string; user_id: string; filename: string; content_type: string; size_bytes: number;
  duration_seconds: number | null; storage_path: string; status: 'uploaded' | 'deleted';
  created_at: string; updated_at: string;
};
export type MarketingDraft = {
  id: string; user_id: string; media_id: string; title: string; description: string; caption: string;
  hashtags: string; platforms: SocialPlatform[]; platform_content: Partial<Record<SocialPlatform, string>>;
  youtube_visibility: 'public' | 'unlisted' | 'private';
  status: 'draft' | 'ready_for_review'; created_at: string; updated_at: string;
};
export type MarketingDraftPostStatus = Pick<SocialPost, 'id' | 'draft_id' | 'platform' | 'status' | 'post_url' | 'error'>;
export type MarketingDraftWithMedia = MarketingDraft & { marketing_media: MarketingMedia; social_posts: MarketingDraftPostStatus[] };

export async function uploadVideoFile(file: Blob, path: string, onProgress: (percent: number) => void) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!token || !key) throw new Error('Sign in again before uploading.');
  if (!base) throw new Error('Supabase is not configured.');
  return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${base}/storage/v1/object/marketing-uploads/${path.split('/').map(encodeURIComponent).join('/')}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', key);
      xhr.setRequestHeader('Content-Type', VIDEO_MIME);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
      xhr.onerror = () => reject(new Error('Upload failed. Check your connection and retry.'));
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(xhr.status === 413 ? 'This video is over the 100 MB upload limit.' : `Upload failed (${xhr.status}).`));
      xhr.send(file);
  });
}

export async function createMedia(input: Omit<MarketingMedia, 'id' | 'created_at' | 'updated_at' | 'status'> & { status?: MarketingMedia['status'] }) {
  const { data, error } = await supabase.from('marketing_media').insert(input).select('*').single();
  if (error) throw new Error(`Could not save uploaded video: ${error.message}`);
  return data as MarketingMedia;
}

export async function saveDraft(input: Omit<MarketingDraft, 'id' | 'user_id' | 'created_at' | 'updated_at'> & { id?: string }) {
  const { id, ...fields } = input;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Sign in again before saving this draft.');
  const query = id
    ? supabase.from('marketing_post_drafts').update(fields).eq('id', id)
    : supabase.from('marketing_post_drafts').insert({ ...fields, user_id: auth.user.id });
  const { data, error } = await query.select('*').single();
  if (error) throw new Error(`Could not save draft: ${error.message}`);
  notifyAnalyticsChanged();
  return data as MarketingDraft;
}

export async function listDrafts() {
  const { data, error } = await supabase.from('marketing_post_drafts').select('*, marketing_media(*)').order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  const drafts = (data ?? []) as (MarketingDraft & { marketing_media: MarketingMedia })[];
  if (!drafts.length) return [] as MarketingDraftWithMedia[];
  const { data: postRows, error: postError } = await supabase.from('social_posts')
    .select('id, draft_id, platform, status, post_url, error')
    .in('draft_id', drafts.map((draft) => draft.id));
  if (postError) throw new Error(postError.message);
  const postsByDraft = new Map<string, MarketingDraftPostStatus[]>();
  for (const post of (postRows ?? []) as MarketingDraftPostStatus[]) {
    if (!post.draft_id) continue;
    postsByDraft.set(post.draft_id, [...(postsByDraft.get(post.draft_id) ?? []), post]);
  }
  return drafts.map((draft) => ({ ...draft, social_posts: postsByDraft.get(draft.id) ?? [] }));
}

export async function listUploadedMedia() {
  const { data, error } = await supabase.from('marketing_media')
    .select('*').eq('status', 'uploaded').order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error(`Could not load uploaded videos: ${error.message}`);
  return (data ?? []) as MarketingMedia[];
}

export async function draftPreviewUrl(path: string) {
  const { data, error } = await supabase.storage.from('marketing-uploads').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error('Could not open the private video preview.');
  return data.signedUrl;
}

export async function listDraftPosts(draftId: string) {
  const { data, error } = await supabase.from('social_posts').select('*').eq('draft_id', draftId).order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as SocialPost[];
}
