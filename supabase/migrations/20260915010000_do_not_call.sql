-- A number that asked not to be called again.
--
-- Single-number calling checks this flag before dialling. It is its own column
-- rather than read from the call outcome, because "not interested today" is not
-- the same as "never call me again", and only the second should block a number
-- for good.
--
-- Safe to re-run.

alter table public.prospects
  add column if not exists do_not_call boolean not null default false;
