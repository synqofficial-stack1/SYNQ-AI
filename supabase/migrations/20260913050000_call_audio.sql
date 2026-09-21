-- Audio that a phone call plays.
--
-- Twilio's <Play> downloads audio from a public address at the moment the call
-- connects, so generated speech needs somewhere reachable to live. The bucket
-- is private and has no storage policies at all: only the call-audio function,
-- running with the service role, writes to it, and Twilio reads through a
-- signed link that expires. A public bucket would be free file hosting for
-- anyone who reads the anon key out of the app bundle.
--
-- Safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('call-audio', 'call-audio', false, 5242880, array['audio/mpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
