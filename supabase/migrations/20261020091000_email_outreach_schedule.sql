-- Run after email_outreach.sql. No credentials are embedded in migration files.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create function public.run_outreach_worker() returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_key text; v_request bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name='outreach_worker_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name='outreach_worker_secret' limit 1;
  if v_url is null or v_key is null then return null; end if;
  select net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','x-outreach-worker',v_key),body:='{}'::jsonb,timeout_milliseconds:=120000) into v_request;
  return v_request;
end; $$;
revoke all on function public.run_outreach_worker() from public,anon,authenticated;
-- pg_cron runs as the database owner; clients cannot invoke the worker hook.
select cron.schedule('synq-email-replies','* * * * *','select public.run_outreach_worker();');
commit;
