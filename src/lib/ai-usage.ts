import { supabase } from '@/lib/supabase';

export type AIUsage = {
  limit: number;
  used: number;
  remaining: number;
  resets_at: string | null;
  chat_cost: number;
  image_cost: number;
};

export async function getAIUsage(): Promise<AIUsage> {
  const { data, error } = await supabase.rpc('get_ai_usage');
  if (error || !data || typeof data.remaining !== 'number') throw new Error('Could not load your credits. The daily credits setup may need completing.');
  return data;
}

export class AICreditError extends Error {
  constructor(public usage: AIUsage & { needed: number }, message: string) { super(message); }
}
