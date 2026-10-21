// Turns an agreed marketing concept into a video with fal.ai's Seedance model.
//
// Two actions on one function, because they are two halves of one job:
//
//   start  — records what was asked for, then submits it to fal's durable queue
//            and keeps the request id.
//   check  — polls that request. When it finishes, the file is pulled down and
//            put in storage, because the download URL needs the API key and the
//            key must never reach the app.
//
// The row is written before submitting to fal so a paid request is never
// invisible if this function dies mid-flight.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildFalInput, FAL_VIDEO_MODEL, parseVideoOptions } from '../_shared/video-generation.ts';

const FAL_QUEUE = 'https://queue.fal.run';
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

/** Return actionable provider errors without ever reflecting request headers. */
async function describeFalError(response: Response) {
  let reason = '';
  try {
    const body = await response.json();
    reason = String(body?.detail?.[0]?.msg ?? body?.error ?? body?.message ?? '');
  } catch {
    // The status is enough when there is no JSON body.
  }

  if (response.status === 401) {
    return 'fal.ai rejected the configured API key (401). Replace FAL_AI_API_KEY with the current fal.ai key.';
  }
  if (response.status === 403) {
    return 'fal.ai denied access to this model (403). Check model availability and account permissions in fal.ai.';
  }
  if (response.status === 402) {
    return 'fal.ai needs an available balance or billing setup before it can generate this video.';
  }
  if (response.status === 429) {
    return 'fal.ai is rate limiting video requests. Wait a little and try again.';
  }
  if (response.status === 422 || response.status === 400) {
    return `fal.ai could not accept these video settings${reason ? `: ${reason}` : '.'}`;
  }
  return `fal.ai video request failed (${response.status})${reason ? `: ${reason}` : '.'}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  // Accept the key name already used in Supabase, while retaining FAL_KEY as
  // a backwards-compatible alias for local/deployment environments.
  const apiKey = Deno.env.get('FAL_AI_API_KEY') ?? Deno.env.get('FAL_KEY');
  if (!apiKey) return json({ error: 'The server is missing its fal.ai API key. Add FAL_AI_API_KEY in Supabase Edge Function secrets.' }, 500);

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
  // start
  // -------------------------------------------------------------------------
  if (body.action === 'start') {
    const prompt = String(body.prompt ?? '').trim().slice(0, MAX_PROMPT_CHARS);
    if (!prompt) return json({ error: 'There is nothing to make a video from yet.' }, 400);

    const conversationId = String(body.conversation_id ?? '');
    if (!conversationId) return json({ error: 'Which conversation is this for?' }, 400);

    const parsedOptions = parseVideoOptions(body);
    if ('error' in parsedOptions) return json({ error: parsedOptions.error }, 400);
    const { aspectRatio: aspect, durationSeconds: duration, resolution } = parsedOptions.options;

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
      response = await fetch(`${FAL_QUEUE}/${FAL_VIDEO_MODEL}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
        body: JSON.stringify(buildFalInput(prompt, parsedOptions.options, user.id)),
      });
    } catch {
      await supabase
        .from('videos')
        .update({ status: 'failed', error: 'Could not reach fal.ai.' })
        .eq('id', video.id);
      return json({ error: 'Could not reach fal.ai. Try again.' }, 502);
    }

    if (!response.ok) {
      const reason = await describeFalError(response);
      await supabase.from('videos').update({ status: 'failed', error: reason }).eq('id', video.id);
      return json({ error: reason, video_id: video.id }, 502);
    }

    const requestId = String((await response.json())?.request_id ?? '');
    if (!requestId) {
      const reason = 'fal.ai accepted the request but returned no job ID to track.';
      await supabase.from('videos').update({ status: 'failed', error: reason }).eq('id', video.id);
      return json({ error: reason, video_id: video.id }, 502);
    }

    const { data: updated } = await supabase
      .from('videos')
      .update({ status: 'generating', operation_name: `fal:${requestId}` })
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
    if (!video.operation_name.startsWith('fal:')) {
      const reason = 'This video was queued with the previous provider and cannot be resumed. Edit its prompt and generate a new fal.ai take.';
      const { data: failed } = await supabase
        .from('videos')
        .update({ status: 'failed', error: reason })
        .eq('id', video.id)
        .select('*')
        .single();
      return json({ video: failed ?? video, error: reason }, 409);
    }

    const requestId = video.operation_name.slice('fal:'.length);
    const auth = { Authorization: `Key ${apiKey}` };
    let poll: Response;
    try {
      poll = await fetch(`${FAL_QUEUE}/${FAL_VIDEO_MODEL}/requests/${encodeURIComponent(requestId)}/status`, {
        headers: auth,
      });
    } catch {
      return json({ video, note: 'Could not reach fal.ai this time. Still waiting.' });
    }

    if (!poll.ok) {
      const reason = await describeFalError(poll);
      const { data: failed } = await supabase
        .from('videos')
        .update({ status: 'failed', error: reason })
        .eq('id', video.id)
        .select('*')
        .single();
      return json({ video: failed ?? video, error: reason }, 502);
    }

    const queueStatus = await poll.json();
    if (queueStatus?.status === 'IN_QUEUE' || queueStatus?.status === 'IN_PROGRESS') {
      const position = Number.isInteger(queueStatus.queue_position) ? queueStatus.queue_position : null;
      return json({ video, note: position === null ? 'Video is processing.' : `Video is queued (${position} ahead).` });
    }

    if (queueStatus?.status !== 'COMPLETED' || queueStatus?.error) {
      const reason = String(queueStatus?.error ?? 'fal.ai could not complete this video.');
      const { data: failed } = await supabase
        .from('videos')
        .update({ status: 'failed', error: reason })
        .eq('id', video.id)
        .select('*')
        .single();
      return json({ video: failed ?? video, error: reason }, 502);
    }

    let result: any;
    try {
      const resultResponse = await fetch(`${FAL_QUEUE}/${FAL_VIDEO_MODEL}/requests/${encodeURIComponent(requestId)}`, { headers: auth });
      if (!resultResponse.ok) throw new Error('fal result request failed');
      result = await resultResponse.json();
    } catch {
      return json({ video, note: 'The job is complete, but fal.ai could not return the file yet. Checking again will retry.' });
    }

    const uri = result?.video?.url ?? null;

    if (!uri) {
      const reason = 'fal.ai finished but returned no video file. Try editing the prompt and generating another take.';
      const { data: failed } = await supabase
        .from('videos')
        .update({ status: 'failed', error: reason })
        .eq('id', video.id)
        .select('*')
        .single();
      return json({ video: failed ?? video, error: reason }, 502);
    }

    // fal's output URL is short-lived. Validate its host and never send FAL_KEY
    // to the media host; the video is copied into Synq's private bucket.
    let bytes: ArrayBuffer;
    try {
      const mediaUrl = new URL(uri);
      const allowedHost = mediaUrl.hostname === 'fal.media'
        || mediaUrl.hostname.endsWith('.fal.media')
        || mediaUrl.hostname === 'storage.googleapis.com';
      if (mediaUrl.protocol !== 'https:' || !allowedHost) throw new Error('Unexpected video host');
      const file = await fetch(mediaUrl);
      if (!file.ok) throw new Error(String(file.status));
      bytes = await file.arrayBuffer();
    } catch {
      return json({ video, note: 'The video is ready but could not be saved yet. Checking again will retry.' });
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

  return json({ error: 'Unknown action. Use "start" or "check".' }, 400);
});
