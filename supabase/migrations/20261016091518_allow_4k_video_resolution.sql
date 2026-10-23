-- Recovered from production migration history on 2026-10-22 (applied live,
-- never committed). This is the version production actually ran. It only
-- widens the resolution check; the duration change in
-- 20261016091113_allow_4k_video_resolution.sql was NOT applied live.

-- Add Veo 3.1 Fast 4K output without changing existing stored video rows.
alter table public.videos
  drop constraint if exists videos_resolution_check;

alter table public.videos
  add constraint videos_resolution_check
  check (resolution in ('720p', '1080p', '4k'));
