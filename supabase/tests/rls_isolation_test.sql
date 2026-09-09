-- Proof that row level security actually isolates users.
--
-- Creates two throwaway users, gives each of them a lead and a task, then puts
-- on user A's identity and tries every way there is to reach user B's rows.
--
-- HOW TO RUN
--   Paste the whole file into the Supabase SQL editor and run it. The final
--   statement prints one row per check. Every `result` column must read PASS.
--   If any check fails the script aborts with an error naming the check.
--
--   The whole thing runs inside begin/rollback, so it leaves no test users,
--   leads or tasks behind. Nothing you already have in the database is touched.
--
-- WHY THE ROLE SWITCHING
--   The SQL editor connects as `postgres`, which bypasses RLS entirely — run
--   these queries as yourself and every check would pass for the wrong reason.
--   `set local role authenticated` plus a faked `request.jwt.claims` is what
--   PostgREST does for a real logged-in request, so this exercises the same
--   code path the mobile app hits.

begin;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

create temporary table rls_test_results (
  seq        int generated always as identity,
  check_name text,
  result     text
) on commit drop;

-- The checks below run while impersonating `authenticated`, so that role needs
-- to be able to write its results here. This is scratch space for the test, not
-- part of the schema — it disappears at rollback.
grant select, insert on rls_test_results to public;

-- Two users. Inserting into auth.users fires on_auth_user_created, so each of
-- them also gets a profile and a Sales AI department — which this doubles as a
-- test of.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'authenticated', 'authenticated', 'rls-test-a@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'authenticated', 'authenticated', 'rls-test-b@example.test', '', now(), now());

-- ---------------------------------------------------------------------------
-- User A creates their own data
-- ---------------------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',
  true
);
set local role authenticated;

insert into public.leads (id, user_id, department_id, name, company, notes, status)
select 'a11d1111-1111-4111-8111-111111111111',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       d.id, 'Alice Lead', 'Acme Co', 'Budget approved, wants a demo.', 'new'
from public.departments d
where d.user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

insert into public.tasks (id, user_id, department_id, task_type, input, status)
select 'a11d2222-2222-4222-8222-222222222222',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       d.id, 'qualify_lead',
       '{"lead_id":"a11d1111-1111-4111-8111-111111111111"}'::jsonb, 'pending'
from public.departments d
where d.user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

reset role;

-- ---------------------------------------------------------------------------
-- User B creates their own data
-- ---------------------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}',
  true
);
set local role authenticated;

insert into public.leads (id, user_id, department_id, name, company, notes, status)
select 'b22d1111-1111-4111-8111-111111111111',
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
       d.id, 'Bob Lead', 'Globex', 'Confidential: Globex renewal is $40k.', 'new'
from public.departments d
where d.user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

insert into public.tasks (id, user_id, department_id, task_type, input, status)
select 'b22d2222-2222-4222-8222-222222222222',
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
       d.id, 'draft_outreach_email',
       '{"lead_id":"b22d1111-1111-4111-8111-111111111111"}'::jsonb, 'pending'
from public.departments d
where d.user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

reset role;

-- ---------------------------------------------------------------------------
-- Now be user A, and try to get at user B's rows
-- ---------------------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  n         int;
  b_lead_id uuid := 'b22d1111-1111-4111-8111-111111111111';
  b_task_id uuid := 'b22d2222-2222-4222-8222-222222222222';
  b_user_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
begin
  -- 1. auth.uid() really is user A inside this block
  if (select auth.uid()) is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid then
    raise exception 'setup broken: auth.uid() is %, expected user A', (select auth.uid());
  end if;
  insert into rls_test_results (check_name, result)
  values ('impersonation works — auth.uid() is user A', 'PASS');

  -- 2. A sees exactly their own lead, and no others
  select count(*) into n from public.leads;
  if n <> 1 then
    raise exception 'FAILED [leads: A sees only own rows] — expected 1 visible lead, got %', n;
  end if;
  select count(*) into n from public.leads
   where user_id <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if n <> 0 then
    raise exception 'FAILED [leads: A sees only own rows] — % foreign lead(s) visible', n;
  end if;
  insert into rls_test_results (check_name, result)
  values ('leads: A sees only their own rows', 'PASS');

  -- 3. Asking for B's lead by primary key returns nothing
  select count(*) into n from public.leads where id = b_lead_id;
  if n <> 0 then
    raise exception 'FAILED [leads: A cannot read B by id] — B''s lead was returned';
  end if;
  insert into rls_test_results (check_name, result)
  values ('leads: A cannot SELECT B''s lead by id', 'PASS');

  -- 4. Same for tasks
  select count(*) into n from public.tasks;
  if n <> 1 then
    raise exception 'FAILED [tasks: A sees only own rows] — expected 1 visible task, got %', n;
  end if;
  select count(*) into n from public.tasks where id = b_task_id;
  if n <> 0 then
    raise exception 'FAILED [tasks: A cannot read B by id] — B''s task was returned';
  end if;
  insert into rls_test_results (check_name, result)
  values ('tasks: A cannot SELECT B''s task', 'PASS');

  -- 5. B's department (and its system_instructions) is invisible to A
  select count(*) into n from public.departments where user_id = b_user_id;
  if n <> 0 then
    raise exception 'FAILED [departments: A cannot read B''s department]';
  end if;
  insert into rls_test_results (check_name, result)
  values ('departments: A cannot SELECT B''s department', 'PASS');

  -- 6. B's profile is invisible to A
  select count(*) into n from public.profiles where id = b_user_id;
  if n <> 0 then
    raise exception 'FAILED [profiles: A cannot read B''s profile]';
  end if;
  insert into rls_test_results (check_name, result)
  values ('profiles: A cannot SELECT B''s profile', 'PASS');

  -- 7. UPDATE against B's lead matches zero rows (silent no-op, not an error)
  update public.leads set notes = 'hijacked' where id = b_lead_id;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAILED [leads: A cannot UPDATE B''s lead] — % row(s) updated', n;
  end if;
  insert into rls_test_results (check_name, result)
  values ('leads: A cannot UPDATE B''s lead', 'PASS');

  -- 8. DELETE against B's lead matches zero rows
  delete from public.leads where id = b_lead_id;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAILED [leads: A cannot DELETE B''s lead] — % row(s) deleted', n;
  end if;
  insert into rls_test_results (check_name, result)
  values ('leads: A cannot DELETE B''s lead', 'PASS');

  -- 9. DELETE against B's task matches zero rows
  delete from public.tasks where id = b_task_id;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAILED [tasks: A cannot DELETE B''s task] — % row(s) deleted', n;
  end if;
  insert into rls_test_results (check_name, result)
  values ('tasks: A cannot DELETE B''s task', 'PASS');

  -- 10. A cannot forge a lead owned by B — the insert policy rejects it
  begin
    insert into public.leads (user_id, name) values (b_user_id, 'forged');
    raise exception 'FAILED [leads: A cannot INSERT as B] — forged row was accepted';
  exception
    when insufficient_privilege then
      insert into rls_test_results (check_name, result)
      values ('leads: A cannot INSERT a row owned by B', 'PASS');
  end;

  -- 11. A cannot hand their own lead over to B by rewriting user_id.
  --     This is the check that fails if an UPDATE policy is missing `with check`.
  begin
    update public.leads
       set user_id = b_user_id
     where id = 'a11d1111-1111-4111-8111-111111111111';
    raise exception 'FAILED [leads: A cannot reassign own lead to B] — reassignment was accepted';
  exception
    when insufficient_privilege then
      insert into rls_test_results (check_name, result)
      values ('leads: A cannot reassign their lead to B', 'PASS');
  end;

  -- 12. Same forgery check on tasks
  begin
    insert into public.tasks (user_id, task_type) values (b_user_id, 'qualify_lead');
    raise exception 'FAILED [tasks: A cannot INSERT as B] — forged row was accepted';
  exception
    when insufficient_privilege then
      insert into rls_test_results (check_name, result)
      values ('tasks: A cannot INSERT a row owned by B', 'PASS');
  end;

  -- 13. RLS is actually switched on for all four tables
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
     and c.relname in ('profiles', 'departments', 'leads', 'tasks')
     and c.relrowsecurity;
  if n <> 4 then
    raise exception 'FAILED [RLS enabled on all four tables] — only % of 4 have it on', n;
  end if;
  insert into rls_test_results (check_name, result)
  values ('RLS is enabled on all four tables', 'PASS');
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Results — every row must say PASS
-- ---------------------------------------------------------------------------

select seq, check_name, result from rls_test_results order by seq;

rollback;
