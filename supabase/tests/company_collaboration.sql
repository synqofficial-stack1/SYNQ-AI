-- Rollback-only workspace isolation and meeting attendee visibility checks.
begin;
set local request.jwt.claim.role='service_role';
do $$
declare
  owner_id uuid:=gen_random_uuid(); member_a uuid:=gen_random_uuid(); member_b uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  org uuid; other_org uuid; meeting uuid:=gen_random_uuid(); task_id uuid:=gen_random_uuid(); n integer;
begin
  insert into auth.users(id,email) values
    (owner_id,owner_id||'@example.invalid'),(member_a,member_a||'@example.invalid'),
    (member_b,member_b||'@example.invalid'),(outsider,outsider||'@example.invalid');
  insert into public.organizations(name,owner_id) values('Collaboration QA '||owner_id,owner_id) returning id into org;
  insert into public.organizations(name,owner_id) values('Other QA '||outsider,outsider) returning id into other_org;
  insert into public.organization_members(user_id,organization_id,role,status) values
    (owner_id,org,'owner','active'),(member_a,org,'member','active'),(member_b,org,'member','active'),(outsider,other_org,'owner','active');

  perform set_config('request.jwt.claim.sub',owner_id::text,true); set local role authenticated;
  insert into public.organization_chat_messages(organization_id,sender_id,body) values(org,owner_id,'QA team message');
  insert into public.organization_tasks(id,organization_id,created_by,assigned_to,title)
    values(task_id,org,owner_id,member_a,'QA assigned task');
  meeting:=public.create_sales_meeting(meeting,'Partner planning',now()+interval '2 days','Shared agenda',array[member_a,member_b]);
  select count(*) into n from public.sales_meeting_attendees where meeting_id=meeting;
  if n<>2 then raise exception 'Organizer did not save all attendees'; end if;
  reset role;

  perform set_config('request.jwt.claim.sub',member_a::text,true); set local role authenticated;
  select count(*) into n from public.organization_chat_messages where body='QA team message';
  if n<>1 then raise exception 'Approved workspace member cannot read team chat'; end if;
  select count(*) into n from public.organization_tasks where id=task_id and assigned_to=member_a;
  if n<>1 then raise exception 'Assigned teammate cannot read their workspace task'; end if;
  select count(*) into n from public.sales_meetings where id=meeting;
  if n<>1 then raise exception 'Participant A cannot read the meeting'; end if;
  select count(*) into n from public.sales_meeting_attendees where meeting_id=meeting;
  if n<>2 then raise exception 'Participant A cannot see the full attendee list'; end if;
  reset role;

  perform set_config('request.jwt.claim.sub',member_b::text,true); set local role authenticated;
  select count(*) into n from public.sales_meeting_attendees where meeting_id=meeting;
  if n<>2 then raise exception 'Participant B cannot see the full attendee list'; end if;
  update public.organization_tasks set status='completed' where id=task_id;
  reset role;
  select count(*) into n from public.organization_tasks where id=task_id and status='completed';
  if n<>0 then raise exception 'A teammate not on the task could change it'; end if;

  perform set_config('request.jwt.claim.sub',member_a::text,true); set local role authenticated;
  update public.organization_tasks set status='in_progress' where id=task_id;
  reset role;
  select count(*) into n from public.organization_tasks where id=task_id and status='in_progress';
  if n<>1 then raise exception 'The assignee could not update their own task'; end if;

  perform set_config('request.jwt.claim.sub',outsider::text,true); set local role authenticated;
  select count(*) into n from public.organization_chat_messages where body='QA team message';
  if n<>0 then raise exception 'Unrelated workspace member can read team chat'; end if;
  select count(*) into n from public.organization_tasks where id=task_id;
  if n<>0 then raise exception 'Unrelated workspace member can read the task'; end if;
  select count(*) into n from public.sales_meetings where id=meeting;
  if n<>0 then raise exception 'Unrelated workspace member can read the meeting'; end if;
  select count(*) into n from public.sales_meeting_attendees where meeting_id=meeting;
  if n<>0 then raise exception 'Unrelated workspace member can read meeting attendees'; end if;
  begin
    perform public.create_sales_meeting(gen_random_uuid(),'Unauthorized invite',now()+interval '3 days','',array[member_a]);
    raise exception 'Cross-workspace meeting creation succeeded';
  exception when raise_exception then
    if SQLERRM='Cross-workspace meeting creation succeeded' then raise; end if;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub',owner_id::text,true); set local role authenticated;
  perform public.update_sales_meeting_attendees(meeting,array[member_b]);
  select count(*) into n from public.sales_meeting_attendees where meeting_id=meeting;
  if n<>1 then raise exception 'Attendee changes were not applied'; end if;
  reset role;
  raise notice 'Company chat/task tenant policies and Sales meeting participant visibility passed';
end $$;
rollback;
