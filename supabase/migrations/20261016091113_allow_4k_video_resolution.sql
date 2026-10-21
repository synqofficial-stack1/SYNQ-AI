-- Keep legacy resolution values readable; new fal.ai Seedance jobs currently
-- generate 720p only. Accept the supported Seedance duration options.
alter table public.videos
  drop constraint if exists videos_resolution_check;

alter table public.videos
  add constraint videos_resolution_check
  check (resolution in ('720p', '1080p', '4k'));

alter table public.videos
  drop constraint if exists videos_duration_check;

alter table public.videos
  add constraint videos_duration_check
  check (duration_seconds in (4, 5, 6, 8, 10, 12, 15));
