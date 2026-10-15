-- These SECURITY DEFINER functions are trigger entry points, not public RPCs.
-- Trigger execution does not require callers to have direct EXECUTE grants.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.sync_lead_status_from_call() from public, anon, authenticated;
revoke all on function public.events_from_tasks() from public, anon, authenticated;
revoke all on function public.events_from_videos() from public, anon, authenticated;
revoke all on function public.events_from_calls() from public, anon, authenticated;
revoke all on function public.events_from_leads() from public, anon, authenticated;
revoke all on function public.events_from_sales_runs() from public, anon, authenticated;
revoke all on function public.events_from_prospects() from public, anon, authenticated;
revoke all on function public.events_from_conversations() from public, anon, authenticated;
revoke all on function public.events_from_profiles() from public, anon, authenticated;
