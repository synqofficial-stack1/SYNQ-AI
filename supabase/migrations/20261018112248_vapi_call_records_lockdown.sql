-- Recovered from production migration history on 2026-10-22 (applied live,
-- never committed).

-- Remove project default grants first, then give each role only what it needs.
revoke all on table public.vapi_calls from public, anon, authenticated, service_role;

grant select, insert, update on table public.vapi_calls to authenticated;
grant select, update on table public.vapi_calls to service_role;
