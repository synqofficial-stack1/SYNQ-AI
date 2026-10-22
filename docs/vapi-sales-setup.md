# Connect the saved Vapi assistant to Synq

Synq is an Expo Router app (web and native), not a Next.js app. The web Sales
page now uses the official `@vapi-ai/web` SDK to start a browser voice session
with the existing saved assistant. The call uses the dashboard assistant as-is;
the app overrides only a Synq session ID. Existing ElevenLabs phone calling
remains separate and unchanged.

## What the app stores

The `vapi_calls` table stores the signed-in Synq user's call session, transcript,
summary, outcome, and end reason. RLS restricts reads and client updates to that
user. `vapi-call-result` accepts Vapi's `end-of-call-report` event only after a
Bearer credential check, then uses the Supabase server key to update the session
created by that user. It does not store the audio recording.

## Configure Synq and Supabase

1. In `.env.local`, set `EXPO_PUBLIC_VAPI_PUBLIC_KEY` to the **public** key from
   Vapi Dashboard → **API Keys** (choose the public key, not the private API
   key), and
   `EXPO_PUBLIC_VAPI_ASSISTANT_ID` to the existing assistant ID. These values
   are intended for a browser. Never put the Vapi private API key in an
   `EXPO_PUBLIC_` variable.
2. Restart Expo after changing `.env.local`.
3. The `vapi_calls` migrations and `vapi-call-result` Edge Function have
   already been applied to the connected Synq project. The function URL is:

   ```text
   https://jjdrlgwpvxyxeruyygli.supabase.co/functions/v1/vapi-call-result
   ```

4. In Supabase → Edge Functions → Secrets, add `VAPI_WEBHOOK_SECRET`. Use a
   long random bearer token you generate and retain securely. Do not add it to
   `.env.local`, the app bundle, or Git. The Edge Function runtime already
   supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
5. In Vapi Dashboard → Organization Settings → Credentials, create a Bearer
   Token credential with header `Authorization`, the `Bearer` prefix enabled,
   and the same token value. The token is shared only between Vapi and this
   Supabase callback.

The local repo already has `GEMINI_API_KEY` in `.env.local`; the private value
was not read or printed. It is not required by the Vapi callback, which stores
the analysis Vapi sends. If the saved assistant uses a Google/Gemini model with
your own provider key, check its Vapi Credential and rotate/add that credential
in Vapi Dashboard → **Credentials**. To get a Gemini key, use
[Google AI Studio API Keys](https://aistudio.google.com/apikey); keep it in
Vapi's credential store or a server-side secret, never in an `EXPO_PUBLIC_`
variable. The connected Supabase project’s current secret values are not
readable through the available project tools, so whether its existing Gemini
secret is set remains unverified.

## Configure the existing assistant without changing its prompt

Open the existing Synq sales assistant in Vapi Dashboard. Leave its model,
system prompt, and first message untouched.

1. Under **Voice**, verify the intended voice provider and voice ID are active.
   Select a language/accent appropriate for the customers; do not change the
   assistant unless that matches your existing choice.
2. Under **Transcriber**, verify the selected provider, model, and language. If
   the provider supports it, configure a fallback transcriber for provider
   errors. Test names and product terms in the transcript before relying on it.
3. Under **Conversation**, verify the first-message mode matches the configured
   first message, the end-of-turn/silence behavior is comfortable, interruption
   handling is enabled as intended, and a maximum call duration is set.
4. Under **Analysis**, enable a concise call summary and an outcome evaluation
   or structured output. Vapi's current recommendation for new structured
   extraction is **Structured Outputs** attached to the assistant. The Synq
   callback stores `call.analysis.summary`, `call.analysis.successEvaluation`,
   and any `artifact.structuredOutputs` included in the end-of-call report.
5. Under **Server URL**, set the deployed callback URL:

   ```text
   https://jjdrlgwpvxyxeruyygli.supabase.co/functions/v1/vapi-call-result
   ```

   Attach the Bearer credential created above and include the
   `end-of-call-report` server message. First inspect the existing Server URL
   and tools. If that URL already handles function tools or other events, do
   not replace it: this Synq endpoint currently handles end-of-call reports and
   ignores other event types. Keep the existing handler and merge/forward the
   end-of-call report to the Synq URL, or share the current handler details so
   the endpoints can be consolidated safely.

## Phone calling

The Synq Vapi widget is a browser microphone session and needs no phone number.
It is suitable for an assistant connectivity test, but Vapi and the configured
LLM, voice, or transcription providers may charge for usage. The widget asks for
confirmation before starting; no call was started during this setup.

The existing Synq outbound phone workflow is still ElevenLabs-based. A Vapi
outbound phone integration would require the Vapi private API key stored as a
server-only Supabase secret, the Vapi assistant ID, a Vapi phone-number ID, and
an active supported telephony provider/number. Country-specific caller ID,
registration, and outbound restrictions apply. No number or provider was
created or purchased here. Do not configure outbound calling until the intended
provider, region, number, and budget are confirmed.

## Verify

After the dashboard and Supabase steps are complete, open Synq → Sales on HTTPS,
sign in, and use **Test voice assistant**. Browser microphone permission is
required. End the session and check **Recent Vapi sessions** for the final
transcript and summary. In Vapi → Logs → Calls, confirm the call's transcript,
analysis, and webhook delivery. This is a real Vapi web session and may use
billable credits; use it only when you have approved the potential usage.
