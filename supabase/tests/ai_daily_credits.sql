-- Run after the migration in a test project's SQL editor. All changes roll back.
-- Requires one existing customer. No provider requests are made.
begin;
set local request.jwt.claim.role = 'service_role';
do $$
declare
  v_user uuid;
  v_result jsonb;
  v_debit uuid;
  v_used integer;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise exception 'Create a test customer first'; end if;
  insert into public.ai_credit_accounts(user_id, credit_limit, used, window_started_at)
    values(v_user, 50, 49, clock_timestamp())
    on conflict (user_id) do update set credit_limit = 50, used = 49,
      window_started_at = clock_timestamp(), window_id = gen_random_uuid();

  v_result := public.reserve_ai_credits(v_user, 'image');
  if (v_result->>'allowed')::boolean or (v_result->>'remaining')::integer <> 1 then
    raise exception 'Image spent the final chat credit';
  end if;
  v_result := public.reserve_ai_credits(v_user, 'chat');
  if not (v_result->>'allowed')::boolean or (v_result->>'remaining')::integer <> 0 then
    raise exception 'The 50th chat should succeed';
  end if;
  v_debit := (v_result->>'debit_id')::uuid;
  v_result := public.reserve_ai_credits(v_user, 'chat');
  if (v_result->>'allowed')::boolean then raise exception 'The 51st chat must fail'; end if;
  perform public.refund_ai_credits(v_debit);
  perform public.refund_ai_credits(v_debit);
  select used into v_used from public.ai_credit_accounts where user_id = v_user;
  if v_used <> 49 then raise exception 'Refund was not idempotent'; end if;

  v_result := public.reserve_ai_credits(v_user, 'chat');
  v_debit := (v_result->>'debit_id')::uuid;
  update public.ai_credit_accounts set window_started_at = clock_timestamp() - interval '25 hours' where user_id = v_user;
  v_result := public.reserve_ai_credits(v_user, 'image');
  if not (v_result->>'allowed')::boolean or (v_result->>'remaining')::integer <> 48 then
    raise exception '24-hour reset or 2-credit image charge failed';
  end if;
  perform public.refund_ai_credits(v_debit);
  select used into v_used from public.ai_credit_accounts where user_id = v_user;
  if v_used <> 2 then raise exception 'Old-window refund changed the new balance'; end if;

  perform set_config('request.jwt.claim.sub', v_user::text, true);
  if (public.get_ai_usage()->>'remaining')::integer <> 48 then raise exception 'Own usage read failed'; end if;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  if (public.get_ai_usage()->>'remaining')::integer <> 50 then raise exception 'Usage leaked between customers'; end if;
  if has_function_privilege('authenticated', 'public.reserve_ai_credits(uuid,text)', 'execute')
    or has_function_privilege('authenticated', 'public.refund_ai_credits(uuid)', 'execute')
    or has_table_privilege('authenticated', 'public.ai_credit_accounts', 'update') then
    raise exception 'Client can alter credits';
  end if;
  raise notice 'Daily credit database checks passed';
end;
$$;
rollback;

-- Concurrency check in a disposable test account, using two SQL sessions:
-- Seed used=49 in the current window. In A, begin; reserve one chat and leave
-- the transaction open. In B, reserve a chat for the same user: it must wait.
-- Commit A. B must return allowed=false, remaining=0. For two image requests
-- seed used=48: only one may succeed. Do not run this against a customer in use.
