-- Let the dashboard refresh as work is recorded, including background call
-- status changes. Every published table already has authenticated RLS policies.
do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'tasks', 'sales_runs', 'prospects', 'calls', 'videos', 'messages', 'leads'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end;
$$;
