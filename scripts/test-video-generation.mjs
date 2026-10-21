import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFalInput, FAL_VIDEO_MODEL, parseVideoOptions } from '../supabase/functions/_shared/video-generation.ts';

test('uses the selected fal Seedance 2 text-to-video endpoint', () => {
  assert.equal(FAL_VIDEO_MODEL, 'bytedance/seedance-2.0/text-to-video');
});

test('fal receives duration as the enum string and retains portrait framing', () => {
  const parsed = parseVideoOptions({ aspect_ratio: '9:16', duration_seconds: 6, resolution: '720p' });
  assert.ok('options' in parsed);
  assert.deepEqual(buildFalInput('A product reveal', parsed.options, 'user-123'), {
    prompt: 'A product reveal',
    resolution: '720p',
    duration: '6',
    aspect_ratio: '9:16',
    generate_audio: true,
    end_user_id: 'user-123',
  });
});

test('rejects resolutions the selected fal model does not support', () => {
  assert.deepEqual(parseVideoOptions({ resolution: '1080p' }), {
    error: 'Seedance 2.0 text-to-video currently supports 720p output only.',
  });
});

test('rejects durations outside fal model limits before sending a paid request', () => {
  assert.deepEqual(parseVideoOptions({ duration_seconds: 3 }), {
    error: 'Choose a supported video length between 4 and 15 seconds.',
  });
  assert.deepEqual(parseVideoOptions({ duration_seconds: 16 }), {
    error: 'Choose a supported video length between 4 and 15 seconds.',
  });
  assert.deepEqual(parseVideoOptions({ duration_seconds: 5.5 }), {
    error: 'Choose a supported video length between 4 and 15 seconds.',
  });
});
