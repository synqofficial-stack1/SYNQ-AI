-- Rollback-only integration checks; creates no persistent users or campaigns.
begin;
set local request.jwt.claim.role='service_role';
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid();
  ca uuid; cb uuid; ra uuid; rb uuid; n integer;
begin
  insert into auth.users(id,email) values(a,'outreach-qa-a-'||a||'@example.invalid'),(b,'outreach-qa-b-'||b||'@example.invalid');
  ca:=public.create_outreach_campaign(a,'QA A','Research','["Budget?"]','Question','Hello {{name}}','[{"email":"qa-a@example.invalid","name":"Alex"}]');
  cb:=public.create_outreach_campaign(b,'QA B','Research','[]','Question','Hello','[{"email":"qa-b@example.invalid","name":""}]');
  select id into ra from public.outreach_recipients where campaign_id=ca;
  select id into rb from public.outreach_recipients where campaign_id=cb;
  insert into public.outreach_messages(recipient_id,gmail_message_id,sender,body,received_at) values
    (ra,'qa-a','qa-a@example.invalid','Private reply A',now()),(rb,'qa-b','qa-b@example.invalid','Private reply B',now());
  if public.claim_outreach_campaign(ca) then raise exception 'Draft was eligible for worker execution'; end if;
  update public.outreach_campaigns set status='active' where id=ca;
  if not public.claim_outreach_campaign(ca) then raise exception 'Active campaign could not be claimed'; end if;
  if public.claim_outreach_campaign(ca) then raise exception 'A live campaign lease was acquired twice'; end if;

  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  set local role authenticated;
  select count(*) into n from public.outreach_campaigns where id in(ca,cb);
  if n<>1 then raise exception 'Campaign ownership isolation failed'; end if;
  select count(*) into n from public.outreach_recipients where id in(ra,rb);
  if n<>1 then raise exception 'Recipient ownership isolation failed'; end if;
  select count(*) into n from public.outreach_messages where recipient_id in(ra,rb);
  if n<>1 then raise exception 'Reply ownership isolation failed'; end if;
  if has_table_privilege('authenticated','public.outreach_mailboxes','select')
    or has_table_privilege('authenticated','public.outreach_oauth_states','select')
    or has_table_privilege('authenticated','public.outreach_campaigns','update')
    or has_table_privilege('authenticated','public.outreach_recipients','update')
    or has_function_privilege('authenticated','public.claim_outreach_campaign(uuid)','execute') then
    raise exception 'Client has privileged email access';
  end if;
  reset role;
  raise notice 'Email ownership and lease checks passed';
end; $$;
rollback;
