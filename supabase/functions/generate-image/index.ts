// eslint-disable-next-line import/no-unresolved -- This module is resolved by Deno's JSR registry.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { withAICredits } from '../_shared/ai-credits.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Sign in before creating an image.' }, 401);
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return json({ error: 'Your session expired. Sign in again.' }, 401);
  let body: { prompt?: unknown; department?: unknown; aspect_ratio?: unknown; action?: unknown; data_url?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid request.' }, 400);
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 4000) return json({ error: 'Describe your image in 1–4000 characters.' }, 400);
  const prompt = body.prompt.trim();
  if (body.department !== 'sales' && body.department !== 'marketing') return json({ error: 'Choose Sales or Marketing.' }, 400);
  const savePoster = body.action === 'save-poster';
  if (body.action && !savePoster) return json({ error: 'Unknown image action.' }, 400);
  if (savePoster && (typeof body.data_url !== 'string' || body.data_url.length > 21_000_000 || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(body.data_url))) return json({ error: 'The poster could not be read. Please try again.' }, 400);
  if (!savePoster && !['1:1', '4:5', '16:9', '9:16'].includes(String(body.aspect_ratio))) return json({ error: 'Choose a supported image size.' }, 400);
  const key = Deno.env.get('POLLINATIONS_API_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey) return json({ error: 'Image storage needs the server storage secret configured.' }, 503);
  if (!savePoster && !key) return json({ error: 'Add POLLINATIONS_API_KEY to Supabase Edge Function secrets to enable image creation.' }, 503);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  // Check the schema before spending provider quota on a fresh installation.
  const { error: schemaError } = await admin.from('generated_images').select('id').limit(0);
  if (schemaError) return json({ error: 'Apply the AI Mode images migration before creating images.' }, 503);
  const model = Deno.env.get('POLLINATIONS_IMAGE_MODEL') || 'black-forest-labs/flux.1-schnell';
  const generate = async () => {
  let path: string | undefined;
  try {
    let imageData: string;
    if (savePoster) {
      imageData = (body.data_url as string).split(',')[1];
    } else {
      const sizes: Record<string, string> = { '1:1': '1024x1024', '4:5': '1024x1280', '16:9': '1024x576', '9:16': '576x1024' };
      // Receive the image bytes directly; keep credentials and provider URLs out of the browser.
      const response = await fetch('https://gen.pollinations.ai/v1/images/generations', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(110_000),
        body: JSON.stringify({ model, prompt, n: 1, size: sizes[String(body.aspect_ratio)], response_format: 'b64_json' }),
      });
      if (!response.ok) {
        const message = response.status === 401 || response.status === 403
          ? 'Pollinations rejected the image key or model access. Check POLLINATIONS_API_KEY in Supabase Edge Function secrets.'
          : response.status === 402 ? 'Your Pollinations balance or API key budget is exhausted. Check your Pollinations account.'
          : response.status === 429 ? 'Pollinations is receiving too many requests. Please try again shortly.'
          : 'Pollinations could not create the image. Try again or check POLLINATIONS_IMAGE_MODEL and model access.';
        return json({ error: message }, 502);
      }
      const result = await response.json();
      imageData = result?.data?.[0]?.b64_json;
      if (typeof imageData !== 'string' || !imageData) return json({ error: 'No image was produced. Try a clearer description or another prompt.' }, 422);
    }
    if (imageData.length > 20_971_520) return json({ error: 'The generated image is too large to save.' }, 502);
    const bytes = Uint8Array.from(atob(imageData), (char) => char.charCodeAt(0));
    // Pollinations returns base64 without a MIME type. Verify raster signatures before storage.
    const matches = (signature: number[], offset = 0) => signature.every((value, i) => bytes[offset + i] === value);
    const mimeType = matches([137, 80, 78, 71, 13, 10, 26, 10]) ? 'image/png'
      : matches([255, 216, 255]) ? 'image/jpeg'
      : matches([82, 73, 70, 70]) && matches([87, 69, 66, 80], 8) ? 'image/webp' : undefined;
    if (!mimeType) return json({ error: 'The image service returned an unsupported image. Please try again.' }, 422);
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
    const id = crypto.randomUUID();
    path = `${data.user.id}/${id}.${extension}`;
    const { error: uploadError } = await admin.storage.from('ai-images').upload(path, bytes, { contentType: mimeType, upsert: false });
    if (uploadError) throw new Error('Could not save the image file. Check the ai-images storage bucket.');
    const { data: saved, error: saveError } = await admin.from('generated_images').insert({ id, user_id: data.user.id, department: body.department, prompt, storage_path: path }).select('*').single();
    if (saveError) throw new Error('Could not save the image to your gallery. Please try again.');
    return json({ image: saved });
  } catch (e) {
    if (path) await admin.storage.from('ai-images').remove([path]);
    return json({ error: e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'Image creation timed out. Please try again.' : e instanceof Error && e.message.startsWith('Could not save') ? e.message : 'Image creation failed. Please try again.' }, 502);
  }
  };
  // Canvas composition only saves the already-paid-for background with text/logo added.
  return savePoster ? generate() : withAICredits(data.user.id, 'image', generate);
});
