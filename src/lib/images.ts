import { supabase } from '@/lib/supabase';
import { AICreditError } from '@/lib/ai-usage';

import type { GeneratedImage } from '@/types/database';
export type { GeneratedImage } from '@/types/database';

export async function generateImage(prompt: string, department: 'sales' | 'marketing', aspectRatio: string): Promise<GeneratedImage> {
  const { data, error } = await supabase.functions.invoke('generate-image', { body: { prompt, department, aspect_ratio: aspectRatio } });
  if (error) {
    const response = (error as { context?: Response }).context;
    let detail: string | undefined;
    if (response?.json) {
      try {
        const body = await response.json();
        if (body.code === 'AI_CREDIT_LIMIT') throw new AICreditError(body, body.error);
        detail = body.error;
      } catch (e) { if (e instanceof AICreditError) throw e; }
    }
    throw new Error(detail || 'Image creation is unavailable. Deploy generate-image and add POLLINATIONS_API_KEY in Supabase Edge Function secrets.');
  }
  if (!data?.image?.storage_path) throw new Error('No image was returned. Try a different description.');
  return data.image;
}

export async function listImages(department: 'sales' | 'marketing'): Promise<GeneratedImage[]> {
  const { data, error } = await supabase.from('generated_images').select('*').eq('department', department).order('created_at', { ascending: false }).limit(30);
  if (error) throw new Error('Could not load your images. Apply the AI Mode migration and try again.');
  return data ?? [];
}

export async function imageUrl(image: GeneratedImage): Promise<string> {
  const { data, error } = await supabase.storage.from('ai-images').createSignedUrl(image.storage_path, 3600);
  if (error || !data?.signedUrl) throw new Error('Could not open this image.');
  return data.signedUrl;
}
