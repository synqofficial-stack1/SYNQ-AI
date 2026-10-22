-- Recovered from production migration history on 2026-10-22 (applied live,
-- never committed).

-- Existing integrations remain enabled by default, preserving current behavior.
alter table public.social_connections
  add column if not exists publishing_enabled boolean not null default true;
