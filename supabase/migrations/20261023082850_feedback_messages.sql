-- Feedback people write to the Synq team from Settings > Help.
--
-- Unlike everything else the CEO console reads, these rows are *meant* for the
-- platform owner: the person typed them into a box addressed to the Synq team.
-- So admin-console returns their text, which it does for nothing else.
--
-- People can send and read their own messages. Nobody can edit or delete one
-- from the app, and only the service role (admin-console, after its app_admins
-- check) can set acknowledged_at, which the sender then sees as
-- "Looking into it".

create table public.feedback_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

create index feedback_messages_created_idx on public.feedback_messages (created_at desc);
create index feedback_messages_user_idx on public.feedback_messages (user_id, created_at desc);

alter table public.feedback_messages enable row level security;

create policy "feedback: read own"
  on public.feedback_messages for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "feedback: send own"
  on public.feedback_messages for insert to authenticated
  with check ((select auth.uid()) = user_id and acknowledged_at is null);

-- The admin bell is not an inbox anyone should be able to flood.
create or replace function public.limit_feedback_messages()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*) from public.feedback_messages
    where user_id = new.user_id and created_at > now() - interval '1 day'
  ) >= 20 then
    raise exception 'You have sent a lot of feedback today. Please try again tomorrow, or message us on WhatsApp.';
  end if;
  new.created_at := now();
  return new;
end;
$$;

create trigger feedback_messages_limit
  before insert on public.feedback_messages
  for each row execute function public.limit_feedback_messages();
