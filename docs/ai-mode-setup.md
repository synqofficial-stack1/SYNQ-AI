# AI Mode

**Open AI mode** is in the top-right corner on every workspace page, including Dashboard, Control Center, Sales, CRM, Cold Call, Follow-ups, Marketing, Activity, and Plugins. **Close AI mode** is in the top-right corner of the chat. Switching pages in the sidebar keeps the mode open and selects the corresponding assistant. Dashboard and other workspace pages use the existing Synq assistant. Sales and Marketing remain the only departments.

The web workspace now uses the actual components and styles from the uploaded Sales Manager project:

- Chats panel with new chat, search, grouping, filters, and pinned chats.
- Clock button opening full Chat history with search, sorting, rename, pin, export, move between existing assistants, and delete with confirmation.
- Image button in the message composer, automatic image requests, and generated pictures inside the chat.
- Inline poster form with business name, occasion, offer, contact, style, size, and optional logo; the generated background is composed with the chosen text and logo.
- PDF/photo attachments, formatted replies, copy/download, and editing a message to revise a response.

The UI matches the reference web application. Native Expo keeps the existing chat fallback; the full poster workspace is available in desktop and mobile browsers. Supabase calls Gemini for chat and Pollinations for image generation. Image and poster controls use the same interface and private storage as before.

## History and files

Text conversations continue to save in the authenticated Supabase conversations/messages tables, and existing account chats are imported into the panel. Browser history, pin/rename/move preferences, inline poster forms, and image placement are cached separately for each signed-in user, as in the uploaded prototype. An edited message creates a revised server conversation; the earlier server conversation remains in account history. Delete removes the linked conversation from the account as well as its local entry; generated image files remain in private storage.

Attached PDF/photo bytes are sent to the server for the current response and are not kept in browser storage. Reattach a document if you need to analyse it again after reloading. Generated images use private signed URLs, refreshed when reopening AI Mode. Clearing browser storage removes browser-only metadata; account text chats can be imported again.

## Deploy the backend

The daily allowance now requires the [daily AI credits setup](daily-ai-credits.md) as well: 50 credits every 24 hours, chat = 1 and image/poster = 2. Deploy the shared credit helper with the functions.

1. Apply `supabase/migrations/20261010180000_ai_mode_images.sql` using the Supabase SQL editor, or your normal migration workflow. If starting a fresh project, apply all migrations in order.
2. Deploy the updated `chat` function, including `_shared/ai-mode.ts` and `_shared/ai-mode-input.ts`.
3. Deploy `generate-image` (JWT verification enabled; it also verifies the user's session itself).
4. Create a server-side secret key at [Pollinations keys](https://enter.pollinations.ai/keys). Save it in your Supabase project's **Edge Functions → Secrets** as **POLLINATIONS_API_KEY**. The key is used only by the server via an Authorization header. Keep **GEMINI_API_KEY** for chat and the other existing Gemini features. **SUPABASE_URL**, **SUPABASE_ANON_KEY**, and **SUPABASE_SERVICE_ROLE_KEY** are provided by the Supabase runtime. Do not put provider/service-role secrets in public Expo variables or paste them into chat.
5. Optional server secret **POLLINATIONS_IMAGE_MODEL** defaults to `black-forest-labs/flux.1-schnell`. Select a raster image model available to your key. The old **IMAGE_MODEL** setting is no longer used by image generation. See the [Pollinations API documentation](https://gen.pollinations.ai/docs) and [model catalog](https://gen.pollinations.ai/image/models).

Adding a key only to the local `.env.local` file does **not** configure a hosted Supabase function. Save it in the Supabase project used by the app, and deploy the updated function. Images require available Pollinations account credits/key budget and model access.

If AI Mode was already deployed, this provider switch only needs the new secret and a redeploy of `generate-image`. It does not need a new migration or a chat redeploy. If the image table/bucket have never been set up, apply the images migration once as described above.

Without the Supabase CLI, open Edge Functions in the dashboard and create `generate-image` via the editor (or edit the existing function). Replace its `index.ts` with `supabase/functions/generate-image/index.ts` from this project, include the imported `_shared/ai-credits.ts` helper at its relative path, then deploy. See the [Supabase dashboard deployment guide](https://supabase.com/docs/guides/functions/quickstart-dashboard) and [secret configuration guide](https://supabase.com/docs/guides/functions/secrets).

CLI example after signing into Supabase and linking your project:

```powershell
supabase db push
supabase functions deploy chat
supabase functions deploy generate-image
```

`db push` applies all pending migrations, including previous call-report changes. Review the pending migration list for your project first. Add secrets through the dashboard without pasting keys into chat.

## Run locally

In the `SYNQ-AI-main` project folder, keep your existing `.env.local` public Supabase configuration, then run `npm run web`. These local files already contain the feature; no reinstall is needed when dependencies are already installed. Restart Expo if the new route doesn't appear.

## Verify after deployment

- Sign in, open Sales AI Mode, draft an email, start another chat, and reopen the original through the Chats panel or full Chat history.
- Use the Image button beside the composer to describe an image. It appears in the conversation. Ask for a poster to open the inline details form, then generate and download it. Reload and reopen the conversation from Chat history.
- Sign in with a second account and confirm the first account's images and chats aren't visible. Account conversations, generated image rows, and private storage use owner-only RLS.
- Check invalid prompts, invalid Pollinations keys, exhausted Pollinations credits/key budgets, and unavailable functions show errors without placeholder artwork.
- Customer calls continue through the existing Sales calling form and its permission, recording, and call-report workflow.

The migration and functions must be deployed before new image creation can work against a hosted Supabase project. Source/build tests do not prove the live provider or deployment is configured. Images may incur provider charges; this interface does not promise a free tier.
