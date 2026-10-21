# Sales AI calls, recordings and reports

In **Sales**, choose **Start AI customer call**, enter the customer's number and offer,
then enter one question per line (up to 12, each at most 300 characters). Confirm
permission to call and record, then choose **Call now**. The agent discloses that
it is AI and that the call is being recorded, asks permission to continue, and asks
the questions one at a time. Existing permission, calling-window and suppression
checks still run on the server.

After a call, **Recent calls → View report & recording** shows the saved full
transcript, duration, customer answers, summary, outcome, sentiment, needs,
objections and next steps. Questions without an answer are marked **Not answered**.
**Listen to recording** plays the audio on web or opens it on mobile. Recording
links expire after ten minutes; pressing the button again creates a fresh link.
Analysis uses the provider's transcript of the recorded conversation; it does not
run a separate transcription of the audio file.

## Deployment

The ZIP contains source changes; they have not been deployed to your Supabase
project. From this project directory, using your authenticated Supabase CLI:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy call-number
supabase functions deploy call-report
supabase functions deploy call-result --no-verify-jwt
```

Confirm the project ref before applying migrations. The new migration is
`20261010090000_sales_call_reports.sql`. Existing ownership policies protect the
new transcript and report fields. Recordings live in the private `call-audio`
bucket; only the server accesses it and issues owner-checked signed URLs.

Set these server secrets through Supabase's dashboard (never in client code):

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_AGENT_ID`
- `ELEVENLABS_PHONE_NUMBER_ID`
- `ELEVENLABS_WEBHOOK_SECRET`
- `GEMINI_API_KEY`
- `CALL_REPORT_MODEL` (optional; default `gemini-2.5-flash`)
- `SALES_CALL_PROVIDER` (`exotel` for Exotel; defaults to `twilio` for compatibility)

Use a number from the selected carrier connected to your ElevenLabs agent. In the agent's Security
settings, enable **system prompt** and **first message** overrides. Enable audio
retention/recording storage so the conversation audio API can return the recording.
Add a boolean data-collection field named `do_not_call` to capture opt-outs; retain
the existing `note` and `temperature` fields if already configured.

### Indian numbers: Exotel

ElevenLabs supports inbound and outbound calls using Exotel numbers. For local
Indian calling, set the Supabase server secret `SALES_CALL_PROVIDER=exotel`.
The server then uses ElevenLabs' Exotel outbound endpoint instead of Twilio's.
The frontend, custom questions, saved transcripts and report pipeline are shared.

1. Obtain an active Exotel account and provision an Indian number. Ask Exotel
   support to enable the **Voicebot applet** and provision calling channels.
2. Create a Voicebot flow pointing to
   `wss://api.elevenlabs.io/v1/convai/conversation/exotel`, then save/publish it.
   Enable the appropriate recording settings in Exotel and audio retention in
   ElevenLabs. Exotel outbound requests do not accept Twilio's recording flag.
3. In ElevenLabs **Phone Numbers → Import number → From Exotel**, supply the
   Exotel number (`+91...`), Account SID, API Key, API Token, account region, and
   Voicebot Applet ID. Pick the region matching your Exotel account. Store Exotel
   credentials in ElevenLabs' import form; do not add them to the frontend.
4. Set `ELEVENLABS_PHONE_NUMBER_ID` in Supabase to the imported Exotel number's
   ElevenLabs ID (not the raw phone number), and set the agent ID and API key.
5. Redeploy `call-number`. The existing report/recording functions and signed
   post-call webhook continue to use ElevenLabs conversation IDs.
6. After account activation, make an authorized test call and verify audio and
   webhook delivery before using the customer calling flow.

This implementation uses ElevenLabs' default API environment. An ElevenLabs
account with isolated India/EU data residency also requires its matching API and
WebSocket hosts throughout the backend; changing only the WebSocket URL is not
sufficient for this code. Account/number activation and calling permissions are
handled by Exotel; adding code alone does not activate domestic calling.

References: [ElevenLabs Exotel setup](https://elevenlabs.io/docs/eleven-agents/phone-numbers/telephony/exotel),
[Exotel outbound API](https://elevenlabs.io/docs/api-reference/integrations/exotel/outbound-call),
[Twilio India voice guidance](https://www.twilio.com/en-us/guidelines/in/voice).

Configure ElevenLabs' signed **post-call transcription webhook** to:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/call-result
```

Use the matching signing secret above. This webhook saves the transcript, copies
available audio into private storage, and generates the report even after the
Sales screen closes. Without it, results are recovered when Sales or the report
is reopened. The screen also polls while Sales is open. Duplicate webhook/poll
results do not create duplicate CRM calls. Report processing uses a two-minute
lease; stale processing can be recovered by opening the report.

Recordings may be unavailable for calls that fail, receive no answer, or exceed
provider retention. A recording failure preserves the transcript and report.
Failed AI analysis exposes **Retry analysis** without placing another call.
The agent's spoken permission request happens after recording is enabled; this
implementation does not delay the recording start until a spoken response.

## Checks and remaining limits

Run `npm run test:calls` for provider-mocked checks of questions, recording,
calling gates, report validation, failed analysis, processing leases and ownership.
These tests do not call customers or use paid APIs. Also run `npm run lint`,
`npx tsc --noEmit`, and `npx expo export --platform web` with your client Supabase
configuration. The repository has pre-existing whole-project lint failures.

Before production use, perform an authorized test call after deployment and verify
the questions, opt-out field, retained audio, webhook and report on your own account.
No live provider call, deployed migration, or provider recording has been verified
as part of the local source work.
