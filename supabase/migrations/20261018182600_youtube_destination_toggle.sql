-- Existing integrations remain enabled by default, preserving current behavior.
alter table public.social_connections
  add column if not exists publishing_enabled boolean not null default true;
