-- Rollback-only integration test: no persistent accounts, email, or AI calls.
begin;
set local request.jwt.claim.role='service_role';
do $$
declare
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); d uuid:=gen_random_uuid();
 org uuid; other_org uuid; ca uuid; cb uuid; cc uuid; ra uuid; la uuid; lb uuid; n integer; result jsonb;
begin
 insert into auth.users(id,email) values (a,a||'@example.invalid'),(b,b||'@example.invalid'),(c,c||'@example.invalid'),(d,d||'@example.invalid');
 ca:=public.create_outreach_campaign(a,'QA owner','Research','[]','Question','Hello','[{"email":"qa@example.invalid","name":""}]');
 cb:=public.create_outreach_campaign(b,'QA teammate','Research','[]','Question','Hello','[{"email":"qb@example.invalid","name":""}]');
 cc:=public.create_outreach_campaign(c,'QA outsider','Research','[]','Question','Hello','[{"email":"qc@example.invalid","name":""}]');
 insert into public.leads(user_id,name) values(a,'QA owner lead') returning id into la;
 insert into public.leads(user_id,name) values(b,'QA member lead') returning id into lb;
 select id into ra from public.outreach_recipients where campaign_id=ca;
 insert into public.outreach_messages(recipient_id,gmail_message_id,sender,body,received_at) values(ra,'qa','qa@example.invalid','QA reply',now());

 perform set_config('request.jwt.claim.sub',a::text,true);set local role authenticated;
 result:=public.setup_workspace('Owner','QA Company '||a,true);
 org:=(result->'membership'->>'organization_id')::uuid;
 if result->'membership'->>'role'<>'owner' then raise exception 'Creator not owner'; end if;
 reset role;
 perform set_config('request.jwt.claim.sub',c::text,true);set local role authenticated;
 result:=public.setup_workspace('Other owner','QA Other '||c,true);other_org:=(result->'membership'->>'organization_id')::uuid;
 reset role;
 perform set_config('request.jwt.claim.sub',b::text,true);set local role authenticated;
 result:=public.setup_workspace('Teammate','QA Company '||a,true);
 if result->'membership'->>'status'<>'pending' or result->'membership'->>'role'<>'member' then raise exception 'Existing company owner takeover';end if;
 select count(*) into n from public.outreach_campaigns where id=ca;
 if n<>0 then raise exception 'Pending user accessed company campaign';end if;
 begin perform public.review_organization_member(b,'approve');raise exception 'Self approval allowed';exception when raise_exception then if SQLERRM='Self approval allowed' then raise;end if;end;
 begin perform public.organization_people();raise exception 'Pending user accessed roster';exception when raise_exception then if SQLERRM='Pending user accessed roster' then raise;end if;end;
 reset role;
 perform set_config('request.jwt.claim.sub',d::text,true);set local role authenticated;
 perform public.setup_workspace('Pending','QA Company '||a,false);
 reset role;

 perform set_config('request.jwt.claim.sub',a::text,true);set local role authenticated;
 if (public.workspace_identity()->'membership'->>'pending_count')::int<>2 then raise exception 'Owner notification count wrong';end if;
 perform public.review_organization_member(b,'approve');
 begin perform public.review_organization_member(c,'approve');raise exception 'Cross-company approval allowed';exception when raise_exception then if SQLERRM='Cross-company approval allowed' then raise;end if;end;
 perform public.review_organization_member(d,'reject');
 reset role;
 perform set_config('request.jwt.claim.sub',b::text,true);set local role authenticated;
 select count(*) into n from public.outreach_campaigns where id in(ca,cb,cc);
 if n<>2 then raise exception 'Approved member sharing or tenant isolation failed';end if;
 select count(*) into n from public.outreach_messages where recipient_id=ra;
 if n<>1 then raise exception 'Shared replies not visible';end if;
 select count(*) into n from public.leads where id in(la,lb);
 if n<>2 then raise exception 'Company leads not shared';end if;
 update public.leads set notes='Shared edit' where id=la;
 get diagnostics n=row_count;if n<>1 then raise exception 'Member cannot edit company contact';end if;
 begin update public.leads set organization_id=other_org where id=la;raise exception 'Tenant reassignment allowed';exception when insufficient_privilege then null;end;
 begin insert into public.leads(user_id,name,organization_id)values(b,'Invalid',other_org);raise exception 'Cross-tenant insert allowed';exception when raise_exception then if SQLERRM='Cross-tenant insert allowed' then raise;end if;end;
 begin perform public.review_organization_member(d,'approve');raise exception 'Member approved request';exception when raise_exception then if SQLERRM='Member approved request' then raise;end if;end;
 if has_table_privilege('authenticated','public.outreach_mailboxes','select') or has_table_privilege('authenticated','public.organization_members','update') then raise exception 'Client granted privileged access';end if;
 reset role;
 update public.outreach_campaigns set status='active' where id=cb;
 perform set_config('request.jwt.claim.sub',a::text,true);set local role authenticated;
 perform public.review_organization_member(b,'remove');reset role;
 if (select status from public.outreach_campaigns where id=cb)<>'paused' then raise exception 'Removed sender campaign not paused';end if;
 perform set_config('request.jwt.claim.sub',b::text,true);set local role authenticated;
 select count(*) into n from public.outreach_campaigns where id in(ca,cb);if n<>0 then raise exception 'Removed member retained company access';end if;
 select count(*) into n from public.leads where id in(la,lb);if n<>0 then raise exception 'Removed member retained company leads';end if;
 select count(*) into n from public.outreach_messages where recipient_id=ra;if n<>0 then raise exception 'Removed member retained replies';end if;
 reset role;
 raise notice 'Company approval, tenant isolation, shared work, and removal checks passed';
end;$$;
rollback;
