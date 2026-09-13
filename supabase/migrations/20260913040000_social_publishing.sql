-- Posting generated videos to Instagram and X.
--
-- Three tables, and two of them are invisible to the app on purpose.
--
--   social_connections — the OAuth tokens that let Synq post as someone. A
--     token is a password with a scope. RLS is on with no policies at all, and
--     table privileges are revoked from the client roles, so a signed-in user
--     cannot read even their own token back. Only the edge functions, using the
--     service role, ever touch it. The app asks social-auth whether an account
--     is connected and gets back a handle, never a credential.
--
--   oauth_states — the short-lived half of an OAuth handshake: which user
--     started it, where to send them afterwards, and for X the PKCE verifier.
--     Single use, ten minutes, same lockdown as above.
--
--   social_posts — what was posted where. Readable by its owner, written only
--     by the social-post function, so a client cannot mark something "posted"
--     that never went out.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Connected accounts
-- ---------------------------------------------------------------------------

create table if not exists public.social_connections (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  platform      text not null
                  constraint social_connections_platform_check
                  check (platform in ('instagram', 'x')),
  -- The id each platform posts under: the Instagram professional account id,
  -- or the X user id.
  account_id    text not null,
  account_name  text,
  -- TODO: encrypt at rest with Supabase Vault before this leaves MVP.
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz,
  scopes        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint social_connections_one_per_platform unique (user_id, platform)
);

drop trigger if exists social_connections_touch_updated_at on public.social_connections;
create trigger social_connections_touch_updated_at
  before update on public.social_connections
  for each row execute function public.touch_updated_at();

alter table public.social_connections enable row level security;
revoke all on table public.social_connections from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. OAuth handshakes in flight
-- ---------------------------------------------------------------------------

create table if not exists public.oauth_states (
  state         text primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  platform      text not null
                  constraint oauth_states_platform_check
                  check (platform in ('instagram', 'x')),
  code_verifier text,
  return_origin text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '10 minutes')
);

alter table public.oauth_states enable row level security;
revoke all on table public.oauth_states from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Posts
-- ---------------------------------------------------------------------------

create table if not exists public.social_posts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  video_id         uuid not null references public.videos (id) on delete cascade,
  platform         text not null
                     constraint social_posts_platform_check
                     check (platform in ('instagram', 'x')),
  caption          text not null default '',
  -- 'publishing' is a claim, not a resting state: it is how two polls arriving
  -- together are stopped from both publishing the same post.
  status           text not null default 'pending'
                     constraint social_posts_status_check
                     check (status in ('pending', 'processing', 'publishing', 'posted', 'failed')),
  -- The platform's in-flight handle: an Instagram container id or an X media id.
  provider_ref     text,
  provider_post_id text,
  post_url         text,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists social_posts_video_idx
  on public.social_posts (user_id, video_id, created_at);

drop trigger if exists social_posts_touch_updated_at on public.social_posts;
create trigger social_posts_touch_updated_at
  before update on public.social_posts
  for each row execute function public.touch_updated_at();

alter table public.social_posts enable row level security;

drop policy if exists social_posts_select_own on public.social_posts;
create policy social_posts_select_own on public.social_posts
  for select to authenticated using ((select auth.uid()) = user_id);

-- Deliberately no insert, update or delete policy. Every write goes through the
-- social-post function, which is the only thing that knows whether a post
-- actually went out.
