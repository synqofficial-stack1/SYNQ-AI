import test from 'node:test';
import assert from 'node:assert/strict';
import { composeMarketingCaption, MARKETING_CAPTION_LIMITS, MARKETING_UPLOAD_LIMIT, validateMarketingCaption, validateMarketingDuration, validateMarketingVideo } from '../src/lib/marketing-validation.ts';

test('accepts MP4 up to the configured private bucket limit', () => {
  assert.equal(validateMarketingVideo('launch.mp4', 'video/mp4', MARKETING_UPLOAD_LIMIT), null);
  assert.match(validateMarketingVideo('launch.mp4', 'video/mp4', MARKETING_UPLOAD_LIMIT + 1), /100 MB/);
});

test('rejects non-MP4, empty, and size-unknown uploads', () => {
  assert.match(validateMarketingVideo('launch.mov', 'video/quicktime', 100), /MP4/);
  assert.match(validateMarketingVideo('launch.mp4', 'video/mp4', 0), /empty/);
  assert.match(validateMarketingVideo('launch.mp4', 'video/mp4', undefined), /empty/);
});

test('combines caption and hashtags without publishing either automatically', () => {
  assert.equal(composeMarketingCaption('  Hello  ', '#Synq'), 'Hello\n\n#Synq');
});

test('applies per-platform caption limits including hashtags', () => {
  for (const [platform, limit] of Object.entries(MARKETING_CAPTION_LIMITS)) {
    assert.equal(validateMarketingCaption(platform, 'a'.repeat(limit), ''), null);
    assert.match(validateMarketingCaption(platform, 'a'.repeat(limit), '#tag'), /characters/);
  }
});

test('enforces target-specific maximum video durations and minimums', () => {
  assert.match(validateMarketingDuration('instagram', 2), /at least 3 seconds/);
  assert.match(validateMarketingDuration('instagram', 901), /15 minutes/);
  assert.match(validateMarketingDuration('x', 141), /2 minutes 20 seconds/);
  assert.match(validateMarketingDuration('linkedin', 1801), /30 minutes/);
  assert.match(validateMarketingDuration('youtube', 901), /unverified upload limit/);
  assert.equal(validateMarketingDuration('x', 140), null);
  assert.match(validateMarketingDuration('youtube', null), /duration to load/);
});
