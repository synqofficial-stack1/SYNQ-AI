import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { canPublishYouTube, confirmedYouTubeVideoId, refreshYouTubeAccessToken, YouTubeRefreshError } from './youtube-oauth.ts';

Deno.test('refresh exchanges an existing refresh token and returns only token status', async () => {
  let requestBody = '';
  const fetcher: typeof fetch = async (_input, init) => {
    requestBody = String(init?.body ?? '');
    return Response.json({ access_token: 'new-access-token', expires_in: 3600 });
  };
  const result = await refreshYouTubeAccessToken('stored-refresh', 'client-id', 'client-secret', fetcher);
  assertEquals(result, { accessToken: 'new-access-token', expiresIn: 3600 });
  assertEquals(new URLSearchParams(requestBody).get('grant_type'), 'refresh_token');
  assertEquals(new URLSearchParams(requestBody).get('refresh_token'), 'stored-refresh');
});

Deno.test('revoked refresh token is classified for reconnect handling', async () => {
  const fetcher: typeof fetch = async () => Response.json({ error: 'invalid_grant' }, { status: 400 });
  const error = await assertRejects(() => refreshYouTubeAccessToken('refresh', 'id', 'secret', fetcher), YouTubeRefreshError);
  assertEquals(error.permanentlyRejected, true);
});

Deno.test('temporary provider failures do not classify the account as revoked', async () => {
  const fetcher: typeof fetch = async () => Response.json({ error: 'server_error' }, { status: 503 });
  const error = await assertRejects(() => refreshYouTubeAccessToken('refresh', 'id', 'secret', fetcher), YouTubeRefreshError);
  assertEquals(error.permanentlyRejected, false);
});

Deno.test('YouTube publishing requires the caller own an enabled connection', () => {
  assertEquals(canPublishYouTube({ user_id: 'owner', publishing_enabled: true }, 'owner'), true);
  assertEquals(canPublishYouTube({ user_id: 'owner', publishing_enabled: false }, 'owner'), false);
  assertEquals(canPublishYouTube({ user_id: 'other', publishing_enabled: true }, 'owner'), false);
  assertEquals(canPublishYouTube(null, 'owner'), false);
});

Deno.test('a post is successful only when YouTube confirms a video id', () => {
  assertEquals(confirmedYouTubeVideoId(true, { id: 'video-123' }), 'video-123');
  assertEquals(confirmedYouTubeVideoId(false, { id: 'video-123' }), null);
  assertEquals(confirmedYouTubeVideoId(true, {}), null);
});
