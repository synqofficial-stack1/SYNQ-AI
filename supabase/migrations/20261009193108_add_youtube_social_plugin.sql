-- Add YouTube to the server-managed social OAuth and post records.
-- OAuth credentials and per-user tokens remain exclusively server-side.

alter table public.social_connections
  drop constraint if exists social_connections_platform_check;
alter table public.social_connections
  add constraint social_connections_platform_check
  check (platform in ('youtube', 'instagram', 'x', 'linkedin'));

alter table public.oauth_states
  drop constraint if exists oauth_states_platform_check;
alter table public.oauth_states
  add constraint oauth_states_platform_check
  check (platform in ('youtube', 'instagram', 'x', 'linkedin'));

alter table public.social_posts
  drop constraint if exists social_posts_platform_check;
alter table public.social_posts
  add constraint social_posts_platform_check
  check (platform in ('youtube', 'instagram', 'x', 'linkedin'));
