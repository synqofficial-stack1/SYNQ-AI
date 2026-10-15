-- Videos generated from a marketing chat.
--
-- A video is not a message. It takes minutes rather than seconds, it can fail
-- halfway, it costs real money per generation, and it produces a file rather
-- than text. All of that needs somewhere to live that a `messages` row cannot
-- provide, so it gets its own table with its own status.
--
-- The row is created before the provider is called, not after. If the request
-- dies mid-flight there is still a record saying what was asked for and what it
-- cost, which matters when every attempt is billed.
--
-- Safe to re-run.

create table if not exists public.videos (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  -- The concept the user approved, stored verbatim. A regenerate reuses it, and
  -- a changed prompt makes a new row rather than overwriting this one.
  prompt          text not null,
  aspect_ratio    text not null default '9:16'
                    constraint videos_aspect_check check (aspect_ratio in ('16:9', '9:16')),
  duration_seconds integer not null default 4
                    constraint videos_duration_check check (duration_seconds in (4, 6, 8)),
  resolution      text not null default '720p'
                    constraint videos_resolution_check check (resolution in ('720p', '1080p')),
  status          text not null default 'pending'
                    constraint videos_status_check
                    check (status in ('pending', 'generating', 'ready', 'failed')),
  -- Returned by predictLongRunning; the handle used to poll for the result.
  operation_name  text,
  storage_path    text,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists videos_conversation_idx
  on public.videos (user_id, conversation_id, created_at);

-- Polling looks rows up by the provider's operation handle.
create index if not exists videos_operation_idx
  on public.videos (operation_name)
  where operation_name is not null;

drop trigger if exists videos_touch_updated_at on public.videos;
create trigger videos_touch_updated_at
  before update on public.videos
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.videos enable row level security;

drop policy if exists videos_select_own on public.videos;
create policy videos_select_own on public.videos
  for select to authenticated using ((select auth.uid()) = user_id);

-- The exists clause matters: without it a forged conversation_id would attach a
-- generation to someone else's thread.
drop policy if exists videos_insert_own on public.videos;
create policy videos_insert_own on public.videos
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = (select auth.uid())
    )
  );

drop policy if exists videos_update_own on public.videos;
create policy videos_update_own on public.videos
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists videos_delete_own on public.videos;
create policy videos_delete_own on public.videos
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
--
-- Private, not public. These are unreleased marketing drafts, and a public
-- bucket means anyone who guesses a path can watch them. The app reads them
-- through short-lived signed URLs instead.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('generated-videos', 'generated-videos', false, 104857600, array['video/mp4'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Objects are stored under "<user id>/<video id>.mp4", so the first path
-- segment is the owner and every policy keys off it.
drop policy if exists videos_storage_select_own on storage.objects;
create policy videos_storage_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'generated-videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists videos_storage_delete_own on storage.objects;
create policy videos_storage_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'generated-videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Deliberately no insert or update policy for authenticated users. Files are
-- written only by the generate-video function using the service role, after the
-- provider returns one. Nothing the client uploads belongs in this bucket.
