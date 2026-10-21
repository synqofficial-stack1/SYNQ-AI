-- One shared rolling 24-hour allowance per authenticated customer.
begin;

create table public.ai_credit_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credit_limit integer not null default 50 check (credit_limit >= 0),
  used integer not null default 0 check (used >= 0 and used <= credit_limit),
  window_id uuid not null default gen_random_uuid(),
  window_started_at timestamptz
);
create table public.ai_credit_debits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.ai_credit_accounts(user_id) on delete cascade,
  window_id uuid not null,
  cost integer not null check (cost in (1, 2)),
  refunded boolean not null default false,
  created_at timestamptz not null default now()
);
create index ai_credit_debits_owner_created on public.ai_credit_debits(user_id, created_at);
alter table public.ai_credit_accounts enable row level security;
alter table public.ai_credit_debits enable row level security;
-- No client writes or direct ledger access, including through the REST API.
revoke all on public.ai_credit_accounts, public.ai_credit_debits from anon, authenticated;
grant all on public.ai_credit_accounts, public.ai_credit_debits to service_role;

create function public.get_ai_usage() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_account public.ai_credit_accounts%rowtype;
  v_used integer := 0;
  v_reset timestamptz;
begin
  if v_uid is null then raise exception 'Sign in to view usage'; end if;
  select * into v_account from public.ai_credit_accounts where user_id = v_uid;
  if v_account.window_started_at + interval '24 hours' > clock_timestamp() then
    v_used := v_account.used;
    v_reset := v_account.window_started_at + interval '24 hours';
  end if;
  return jsonb_build_object('limit', coalesce(v_account.credit_limit, 50), 'used', v_used,
    'remaining', coalesce(v_account.credit_limit, 50) - v_used, 'resets_at', v_reset,
    'chat_cost', 1, 'image_cost', 2);
end;
$$;

create function public.reserve_ai_credits(p_user_id uuid, p_operation text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_account public.ai_credit_accounts%rowtype;
  v_cost integer;
  v_id uuid;
  v_now timestamptz;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Server access required'; end if;
  v_cost := case p_operation when 'chat' then 1 when 'image' then 2 else null end;
  if v_cost is null then raise exception 'Unknown credit operation'; end if;
  insert into public.ai_credit_accounts(user_id) values (p_user_id) on conflict do nothing;
  -- Serialize deductions for this customer, including simultaneous requests in different tabs.
  select * into v_account from public.ai_credit_accounts where user_id = p_user_id for update;
  v_now := clock_timestamp();
  if v_account.window_started_at is null or v_account.window_started_at + interval '24 hours' <= v_now then
    update public.ai_credit_accounts set used = 0, window_id = gen_random_uuid(), window_started_at = v_now
      where user_id = p_user_id returning * into v_account;
  end if;
  if v_account.used + v_cost > v_account.credit_limit then
    return jsonb_build_object('allowed', false, 'needed', v_cost, 'limit', v_account.credit_limit,
      'used', v_account.used, 'remaining', v_account.credit_limit - v_account.used,
      'resets_at', v_account.window_started_at + interval '24 hours');
  end if;
  update public.ai_credit_accounts set used = used + v_cost where user_id = p_user_id returning * into v_account;
  insert into public.ai_credit_debits(user_id, window_id, cost)
    values(p_user_id, v_account.window_id, v_cost) returning id into v_id;
  return jsonb_build_object('allowed', true, 'debit_id', v_id, 'needed', v_cost,
    'limit', v_account.credit_limit, 'used', v_account.used, 'remaining', v_account.credit_limit - v_account.used,
    'resets_at', v_account.window_started_at + interval '24 hours');
end;
$$;

create function public.refund_ai_credits(p_debit_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_debit public.ai_credit_debits%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Server access required'; end if;
  select * into v_debit from public.ai_credit_debits where id = p_debit_id;
  if not found then return; end if;
  perform 1 from public.ai_credit_accounts where user_id = v_debit.user_id for update;
  select * into v_debit from public.ai_credit_debits where id = p_debit_id for update;
  if v_debit.refunded then return; end if;
  -- A delayed refund must not add credits to a newer 24-hour window.
  update public.ai_credit_accounts set used = greatest(0, used - v_debit.cost)
    where user_id = v_debit.user_id and window_id = v_debit.window_id;
  update public.ai_credit_debits set refunded = true where id = p_debit_id;
end;
$$;

revoke all on function public.get_ai_usage() from public, anon;
grant execute on function public.get_ai_usage() to authenticated;
revoke all on function public.reserve_ai_credits(uuid, text) from public, anon, authenticated;
revoke all on function public.refund_ai_credits(uuid) from public, anon, authenticated;
grant execute on function public.reserve_ai_credits(uuid, text) to service_role;
grant execute on function public.refund_ai_credits(uuid) to service_role;
commit;
