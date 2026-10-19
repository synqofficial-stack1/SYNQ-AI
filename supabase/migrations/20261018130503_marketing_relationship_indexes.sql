-- Cover the new marketing media relationships used by delete checks and draft joins.
create index if not exists marketing_post_drafts_media_id_idx
  on public.marketing_post_drafts(media_id);
create index if not exists social_posts_media_id_idx
  on public.social_posts(media_id) where media_id is not null;
