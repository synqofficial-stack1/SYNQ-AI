type FetchLike = typeof fetch;

export class YouTubeRefreshError extends Error {
  constructor(message: string, readonly permanentlyRejected: boolean) {
    super(message);
    this.name = 'YouTubeRefreshError';
  }
}

/** Refreshes a YouTube access token without logging or returning credentials in errors. */
export async function refreshYouTubeAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  fetcher: FetchLike = fetch,
): Promise<{ accessToken: string; expiresIn: number | null }> {
  let response: Response;
  try {
    response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
  } catch {
    throw new YouTubeRefreshError('Google could not be reached to refresh the YouTube login.', false);
  }
  const body = await response.json().catch(() => ({})) as { access_token?: unknown; expires_in?: unknown };
  if (!response.ok || typeof body.access_token !== 'string' || !body.access_token) {
    const rejected = response.status === 400 || response.status === 401;
    throw new YouTubeRefreshError(
      rejected ? 'The YouTube authorization was revoked or expired.' : 'Google could not refresh the YouTube login.',
      rejected,
    );
  }
  const expiresIn = Number(body.expires_in);
  return {
    accessToken: body.access_token,
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : null,
  };
}

export function canPublishYouTube(
  connection: { user_id?: string; publishing_enabled?: boolean | null } | null | undefined,
  userId: string,
): boolean {
  return Boolean(connection && connection.user_id === userId && connection.publishing_enabled !== false);
}

/** Return an ID only when YouTube confirmed the completed insert response. */
export function confirmedYouTubeVideoId(responseOk: boolean, body: { id?: unknown } | null | undefined): string | null {
  return responseOk && typeof body?.id === 'string' && body.id.length > 0 ? body.id : null;
}
