// eslint-disable-next-line import/no-unresolved -- This module is resolved by Deno's JSR registry.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/** Call only after the authenticated query or signed webhook proved ownership. */
export async function storeRecording(db: SupabaseClient, prospect: {
  id: string; user_id: string; conversation_id: string | null; recording_path?: string | null;
}): Promise<string> {
  if (!prospect.conversation_id) throw new Error('This call has no recording.');
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const path = `${prospect.user_id}/${prospect.id}.mp3`;
  if (prospect.recording_path === path) return path;
  const key = Deno.env.get('ELEVENLABS_API_KEY');
  if (!key) throw new Error('Recording access is not configured.');
  const audio = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(prospect.conversation_id)}/audio`, {
    headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(30_000),
  });
  if (!audio.ok) throw new Error('The recording is not available yet. Try again shortly; audio retention must be enabled for your agent.');
  const declared = Number(audio.headers.get('content-length') ?? 0);
  if (declared > 25 * 1024 * 1024) throw new Error('The recording is too large to store.');
  const bytes = await audio.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 25 * 1024 * 1024) throw new Error('The recording is empty or too large to store.');
  const { error: uploadError } = await admin.storage.from('call-audio').upload(path, bytes, { contentType: 'audio/mpeg', upsert: true });
  if (uploadError) throw new Error('Could not save the recording.');
  const { error: pathError } = await db.from('prospects').update({ recording_path: path, recording_error: null }).eq('id', prospect.id);
  if (pathError) throw new Error('Could not link the recording to this call.');
  return path;
}
