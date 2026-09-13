// Turns an agreed marketing concept into a video with Veo.
//
// Three actions on one function:
//
//   models — read-only. Lists the Veo models this key can see. Being listed does
//            NOT prove billing is on: free-tier projects see them too, and get a
//            429 with a quota of zero the moment they try one.
//   start  — records what was asked for, then hands the prompt to Veo and keeps
//            the operation handle.
//   check  — polls that handle. When it finishes, the file is pulled down and
//            put in storage, because the download URL needs the API key and the
//            key must never reach the app.
//
// Every call to Veo is billed from the first second — there is no free tier on
// any model — so the row is written before the request goes out. If this
// function dies mid-flight there is still a record of what was paid for.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Lite is the cheapest Veo there is, under half the price of Fast at the same
// speed, and 720p vertical is all a reel needs. There is no free option to fall
// back to: every Veo model bills from the first second.
const DEFAULT_MODEL = 'veo-3.1-lite-generate-preview';
const BUCKET = 'generated-videos';
const MAX_PROMPT_CHARS = 2000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** Turns a Google error response into something a non-engineer can act on. */
async function describeGoogleError(response: Response, key: string, model: string) {
  let reason = '';
  try {
    reason = String((await response.json())?.error?.message ?? '');
  } catch {
    // Not JSON; the status still tells us enough.
  }

  if (response.status === 429) {
    // Google's own wording is kept: it says whether the limit is zero (no
    // billing) or merely hit (slow down), and those need different fixes.
    const detail = reason ? ` Google said: ${reason.slice(0, 300)}` : '';
    return `Google refused: this project has no video generation quota. Veo has no free tier, so the Google Cloud project behind the key needs a billing account linked.${detail}`;
  }
  if (response.status === 403 || /billing|permission|not enabled|quota/i.test(reason)) {
    return `Google refused the request: ${reason || 'permission denied'}. Veo is a paid model — check that billing is on for this key and that the Generative Language API is enabled.`;
  }
  if (response.status === 400 && /api[_ ]?key|api key not valid/i.test(reason)) {
    return 'Google rejected the API key. Check the GEMINI_API_KEY secret in Supabase.';
  }

  // Model ids move around, so name the ones that work rather than leaving the
  // next person to guess one at a time.
  if (response.status === 404) {
    let available = '';
    try {
      const list = await fetch(`${BASE}/models`, { headers: { 'x-goog-api-key': key } });
      if (list.ok) {
        const usable = ((await list.json())?.models ?? [])
          .map((m: { name?: string }) => String(m.name ?? '').replace(/^models\//, ''))
          .filter((name: string) => name.includes('veo'))
          .slice(0, 8);
        available = usable.length
          ? ` Video models this key can see: ${usable.join(', ')}.`
          : ' This key cannot see any Veo models at all.';
      }
    } catch {
      // Best effort; the 404 is still the headline.
    }
    return `Google has no video model named "${model}".${available}`;
  }

  return `Video generation failed (${response.status})${reason ? `: ${reason}` : ''}.`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return json({ error: 'The server is missing its GEMINI_API_KEY secret.' }, 500);

  const model = Deno.env.get('VEO_MODEL') || DEFAULT_MODEL;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'You are signed out. Log in and try again.' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ error: 'You are signed out. Log in and try again.' }, 401);

  let body: {
    action?: string;
    video_id?: string;
    conversation_id?: string;
    prompt?: string;
    aspect_ratio?: string;
    duration_seconds?: number;
    resolution?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Malformed request.' }, 400);
  }

  // -------------------------------------------------------------------------
  // models — read-only and free. Answers "can this key see Veo", which is not
  // the same question as "is this project paying for Veo".
  // -------------------------------------------------------------------------
  if (body.action === 'models') {
    try {
      const list = await fetch(`${BASE}/models?pageSize=200`, {
        headers: { 'x-goog-api-key': apiKey },
      });
      if (!list.ok) {
        return json({ error: await describeGoogleError(list, apiKey, model) }, 502);
      }
      const names = ((await list.json())?.models ?? []).map((m: { name?: string }) =>
        String(m.name ?? '').replace(/^models\//, '')
      );
      const veo = names.filter((n: string) => n.toLowerCase().includes('veo'));
      return json({
        configured: model,
        veo_models: veo,
        listed: veo.includes(model),
        note: 'Being listed does not mean the project can generate. Veo only works once a billing account is linked to the Google Cloud project behind this key.',
      });
    } catch {
      return json({ error: 'Could not reach Google.' }, 502);
    }
  }

  // -------------------------------------------------------------------------
  // start
  // -------------------------------------------------------------------------
  if (body.action === 'start') {
    const prompt = String(body.prompt ?? '').trim().slice(0, MAX_PROMPT_CHARS);
    if (!prompt) return json({ error: 'There is nothing to make a video from yet.' }, 400);

    const conversationId = String(body.conversation_id ?? '');
    if (!conversationId) return json({ error: 'Which conversation is this for?' }, 400);

    const aspect = body.aspect_ratio === '16:9' ? '16:9' : '9:16';
    const duration = [4, 6, 8].includes(Number(body.duration_seconds))
      ? Number(body.duration_seconds)
      : 4;
    const resolution = body.resolution === '1080p' ? '1080p' : '720p';

    // Written first, so a generation that is billed is never invisible. RLS
    // rejects a conversation_id belonging to anyone else.
    const { data: video, error: insertError } = await supabase
      .from('videos')
      .insert({
        user_id: user.id,
        conversation_id: conversationId,
        prompt,
        aspect_ratio: aspect,
        duration_seconds: duration,
        resolution,
        status: 'pending',
      })
      .select('*')
      .single();

    if (insertError) return json({ error: insertError.message }, 400);

    let response: Response;
    try {
      response = await fetch(`${BASE}/models/${model}:predictLongRunning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            aspectRatio: aspect,
            // A number, not a string. The published REST example shows "4",
            // and the API rejects that with "needs to be a number".
            durationSeconds: duration,
            resolution,
            // personGeneration is deliberately omitted. The docs list
            // allow_adult, but text-to-video rejects it with "not supported",
            // and which values are accepted varies by model and region. Leaving
            // it out lets Google apply whatever its own default is.
          },
        }),
      });
    } catch {
      await supabase
        .from('videos')
        .update({ status: 'failed', error: 'Could not reach Google.' })
        .eq('id', video.id);
      return json({ error: 'Could not reach Google. Try again.' }, 502);
    }

    if (!response.ok) {
      const reason = await describeGoogleError(response, apiKey, model);
      await supabase.from('videos').update({ status: 'failed', error: reason }).eq('id', video.id);
      return json({ error: reason, video_id: video.id }, 502);
    }

    const operationName = (await response.json())?.name ?? null;
    if (!operationName) {
      const reason = 'Google accepted the request but returned no job to track.';
      await supabase.from('videos').update({ status: 'failed', error: reason }).eq('id', video.id);
      return json({ error: reason, video_id: video.id }, 502);
    }

    const { data: updated } = await supabase
      .from('videos')
      .update({ status: 'generating', operation_name: operationName })
      .eq('id', video.id)
      .select('*')
      .single();

    return json({ video: updated ?? video });
  }

  // -------------------------------------------------------------------------
  // check
  // -------------------------------------------------------------------------
  if (body.action === 'check') {
    const videoId = String(body.video_id ?? '');
    if (!videoId) return json({ error: 'Which video?' }, 400);

    const { data: video } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .maybeSingle();
    if (!video) return json({ error: 'That video does not exist.' }, 404);

    // Nothing to poll: already finished, or never started.
    if (video.status === 'ready' || video.status === 'failed') return json({ video });
    if (!video.operation_name) return json({ video });

    let poll: Response;
    try {
      poll = await fetch(`${BASE}/${video.operation_name}`, {
        headers: { 'x-goog-api-key': apiKey },
      });
    } catch {
      return json({ video, note: 'Could not reach Google this time. Still waiting.' });
    }

    if (!poll.ok) {
      const reason = await describeGoogleError(poll, apiKey, model);
      const { data: failed } = await supabase
        .from('videos')
        .update({ status: 'failed', error: reason })
        .eq('id', video.id)
        .select('*')
        .single();
      return json({ video: failed ?? video, error: reason }, 502);
    }

    const operation = await poll.json();
    if (!operation?.done) return json({ video });

    if (operation.error) {
      const reason = String(operation.error.message ?? 'Google could not make this video.');
      const { data: failed } = await supabase
        .from('videos')
        .update({ status: 'failed', error: reason })
        .eq('id', video.id)
        .select('*')
        .single();
      return json({ video: failed ?? video, error: reason }, 502);
    }

    const uri =
      operation?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ?? null;

    if (!uri) {
      // Veo blocks prompts it will not film, and finishes "done" with no sample.
      const reason =
        'Google finished but returned no video. That usually means the concept was refused — try describing it differently.';
      const { data: failed } = await supabase
        .from('videos')
        .update({ status: 'failed', error: reason })
        .eq('id', video.id)
        .select('*')
        .single();
      return json({ video: failed ?? video, error: reason }, 502);
    }

    // The download needs the API key, which is why the server fetches it rather
    // than handing the URI to the app.
    let bytes: ArrayBuffer;
    try {
      const file = await fetch(uri, { headers: { 'x-goog-api-key': apiKey } });
      if (!file.ok) throw new Error(String(file.status));
      bytes = await file.arrayBuffer();
    } catch {
      return json({ video, note: 'The video is ready but the download failed. Checking again will retry.' });
    }

    // Storage writes use the service role: the bucket deliberately has no insert
    // policy for signed-in users, so nothing the client uploads can land here.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const path = `${video.user_id}/${video.id}.mp4`;
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: 'video/mp4', upsert: true });

    if (uploadError) {
      return json({ video, note: `Saving the video failed: ${uploadError.message}` }, 502);
    }

    const { data: ready } = await supabase
      .from('videos')
      .update({ status: 'ready', storage_path: path, error: null })
      .eq('id', video.id)
      .select('*')
      .single();

    return json({ video: ready ?? video });
  }

  return json({ error: 'Unknown action. Use "models", "start" or "check".' }, 400);
});
