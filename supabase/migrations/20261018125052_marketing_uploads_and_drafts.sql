-- User supplied marketing videos and persistent post drafts. Existing generated
-- videos and their publication records remain valid and unchanged.

create table if not exists public.marketing_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null check (length(filename) between 1 and 255),
  content_type text not null check (content_type = 'video/mp4'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 104857600),
  duration_seconds numeric,
  storage_path text not null unique,
  status text not null default 'uploaded' check (status in ('uploaded', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_media_owner_path check (storage_path like (user_id::text || '/%'))
);

create index if not exists marketing_media_owner_created_idx
  on public.marketing_media(user_id, created_at desc);

drop trigger if exists marketing_media_touch_updated_at on public.marketing_media;
create trigger marketing_media_touch_updated_at before update on public.marketing_media
  for each row execute function public.touch_updated_at();

alter table public.marketing_media enable row level security;
drop policy if exists marketing_media_select_own on public.marketing_media;
create policy marketing_media_select_own on public.marketing_media for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists marketing_media_insert_own on public.marketing_media;
create policy marketing_media_insert_own on public.marketing_media for insert to authenticated
  with check ((select auth.uid()) = user_id and storage_path like ((select auth.uid())::text || '/%'));
drop policy if exists marketing_media_update_own on public.marketing_media;
create policy marketing_media_update_own on public.marketing_media for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists marketing_media_delete_own on public.marketing_media;
create policy marketing_media_delete_own on public.marketing_media for delete to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.marketing_post_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_id uuid not null references public.marketing_media(id) on delete restrict,
  title text not null default '',
  description text not null default '',
  caption text not null default '',
  hashtags text not null default '',
  youtube_visibility text not null default 'public' check (youtube_visibility in ('public', 'unlisted', 'private')),
  platforms text[] not null default '{}',
  platform_content jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'ready_for_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_draft_platforms check (platforms <@ array['youtube','instagram','x','linkedin']::text[]),
  constraint marketing_draft_caption_size check (length(caption) <= 5000)
);
create index if not exists marketing_post_drafts_owner_updated_idx
  on public.marketing_post_drafts(user_id, updated_at desc);
drop trigger if exists marketing_post_drafts_touch_updated_at on public.marketing_post_drafts;
create trigger marketing_post_drafts_touch_updated_at before update on public.marketing_post_drafts
  for each row execute function public.touch_updated_at();
alter table public.marketing_post_drafts enable row level security;
drop policy if exists marketing_post_drafts_select_own on public.marketing_post_drafts;
create policy marketing_post_drafts_select_own on public.marketing_post_drafts for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists marketing_post_drafts_insert_own on public.marketing_post_drafts;
create policy marketing_post_drafts_insert_own on public.marketing_post_drafts for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.marketing_media m where m.id = media_id and m.user_id = (select auth.uid()) and m.status = 'uploaded'
  ));
drop policy if exists marketing_post_drafts_update_own on public.marketing_post_drafts;
create policy marketing_post_drafts_update_own on public.marketing_post_drafts for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and exists (
    select 1 from public.marketing_media m where m.id = media_id and m.user_id = (select auth.uid()) and m.status = 'uploaded'
  ));
drop policy if exists marketing_post_drafts_delete_own on public.marketing_post_drafts;
create policy marketing_post_drafts_delete_own on public.marketing_post_drafts for delete to authenticated
  using ((select auth.uid()) = user_id);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('marketing-uploads', 'marketing-uploads', false, 104857600, array['video/mp4'])
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists marketing_uploads_insert_own on storage.objects;
create policy marketing_uploads_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'marketing-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists marketing_uploads_select_own on storage.objects;
create policy marketing_uploads_select_own on storage.objects for select to authenticated
  using (bucket_id = 'marketing-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists marketing_uploads_delete_own on storage.objects;
create policy marketing_uploads_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'marketing-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Extend the existing publisher's record without changing generated-video rows.
alter table public.social_posts alter column video_id drop not null;
alter table public.social_posts add column if not exists media_id uuid references public.marketing_media(id) on delete set null;
alter table public.social_posts add column if not exists draft_id uuid references public.marketing_post_drafts(id) on delete set null;
alter table public.social_posts add column if not exists title text not null default '';
alter table public.social_posts add column if not exists description text not null default '';
alter table public.social_posts add column if not exists youtube_visibility text not null default 'public'
  check (youtube_visibility in ('public', 'unlisted', 'private'));
create unique index if not exists social_posts_draft_platform_once
  on public.social_posts(draft_id, platform) where draft_id is not null;
