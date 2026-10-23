-- Rollback-only checks for feedback_messages: people send and read only their
-- own feedback, cannot edit, delete or self-acknowledge it, cannot send as
-- someone else, and are capped at 20 messages a day.
begin;
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); fid uuid; n int; i int;
begin
  insert into auth.users(id,email) values (a, a||'@example.invalid'), (b, b||'@example.invalid');

  perform set_config('request.jwt.claim.sub', a::text, true); set local role authenticated;
  insert into public.feedback_messages(body) values ('QA feedback') returning id into fid;
  select count(*) into n from public.feedback_messages where id = fid;
  if n <> 1 then raise exception 'Sender cannot read own feedback'; end if;
  begin
    insert into public.feedback_messages(body, acknowledged_at) values ('self ack', now());
    raise exception 'Sender could pre-acknowledge';
  exception when insufficient_privilege then null; end;
  update public.feedback_messages set acknowledged_at = now() where id = fid;
  delete from public.feedback_messages where id = fid;
  reset role;
  select count(*) into n from public.feedback_messages where id = fid and acknowledged_at is null;
  if n <> 1 then raise exception 'Sender could change or delete feedback'; end if;

  perform set_config('request.jwt.claim.sub', b::text, true); set local role authenticated;
  select count(*) into n from public.feedback_messages where id = fid;
  if n <> 0 then raise exception 'Another user can read the feedback'; end if;
  begin
    insert into public.feedback_messages(user_id, body) values (a, 'spoofed');
    raise exception 'User could send as someone else';
  exception when insufficient_privilege then null; end;
  reset role;

  perform set_config('request.jwt.claim.sub', a::text, true); set local role authenticated;
  begin
    for i in 1..20 loop insert into public.feedback_messages(body) values ('spam ' || i); end loop;
    raise exception 'Daily limit did not trigger';
  exception when raise_exception then
    if SQLERRM not like 'You have sent a lot of feedback%' then raise; end if;
  end;
  reset role;
  raise notice 'feedback_messages policies and daily limit passed';
end $$;
rollback;
