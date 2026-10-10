# Marketing video publishing setup

## User flow

1. Sign in and open **Marketing**.
2. Brainstorm a reel idea with Marketing AI. It can return a hook, short shot list, on-screen text, voiceover, call to action, and a platform-specific caption.
3. Select **Generate video from this**, edit the prompt and confirm the paid generation.
4. Preview the finished video, choose YouTube, Instagram, X, or LinkedIn, connect that account if needed, review the caption, and press **Post**. Synq does not publish automatically.

## Supabase function secrets

Add these under the active Supabase project's Edge Function secrets; do not put them in the client `.env.local` file:

- `GEMINI_API_KEY` for Marketing AI chat and Veo reel generation
- `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET`
- `X_CLIENT_ID` and `X_CLIENT_SECRET`
- `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`
- `YOUTUBE_GOOGLE_CONSOLE_CLIENT_ID` and `YOUTUBE_GOOGLE_CONSOLE_CLIENT_SECRET`
- `SOCIAL_TOKEN_ENCRYPTION_KEY`: a random 32-byte key encoded as 64 hexadecimal characters or base64url
- `SOCIAL_ALLOWED_ORIGINS`: comma-separated exact production web origins, such as `https://app.example.com`; localhost ports 8081–8083 and `synqai://oauth-complete` are allowed when this is unset

The encryption key is required before users can connect accounts. Back it up in a password manager. Rotating it without re-encrypting saved tokens will require users to reconnect.

The YouTube API key is optional for this flow: channel verification and uploads use the user's OAuth authorization. A YouTube API key is not a substitute for the OAuth client ID and secret. Local `.env.local` values do not configure the deployed Edge Functions.

## Provider app setup

Use this exact callback URL in each provider's app settings:

`https://jjdrlgwpvxyxeruyygli.supabase.co/functions/v1/social-auth`

- **Instagram:** use Meta's Instagram API with Instagram Login and a professional account with content publishing enabled. Meta may require app review before accounts outside the app's developer/test roles can connect.
- **X:** enable OAuth 2.0 authorization code with PKCE and the `tweet.write`, `users.read`, `media.write`, and `offline.access` scopes. The X API plan must allow video media upload and post creation.
- **LinkedIn:** enable OpenID Connect sign-in and member sharing (`w_member_social`); LinkedIn must grant the app access to the relevant sharing product and permissions.
- **YouTube:** enable YouTube Data API v3, create a Google OAuth Web client, and request the YouTube read-only and upload scopes. Add the callback URI above as an authorized redirect URI. Google may require consent-screen testing users or app verification before broader use.

For a production web release, include the app's HTTPS origin in `SOCIAL_ALLOWED_ORIGINS` and in the provider's OAuth redirect/origin settings where required.

## Data and privacy

`social_connections` and `oauth_states` have RLS enabled and no client table access. OAuth tokens and temporary PKCE verifiers are AES-GCM encrypted in the database; only the Edge Functions decrypt them. `social_posts` is visible only to its owner and clients cannot write posting results. The user confirms every public post in Synq.
