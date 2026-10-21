-- The auth signup trigger inserts only profiles.id. Restore the timestamp
-- default required for that insert to satisfy profiles.created_at NOT NULL.
alter table public.profiles
  alter column created_at set default now();
