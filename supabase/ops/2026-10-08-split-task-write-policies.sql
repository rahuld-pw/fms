-- Run once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query -> Run).
-- It is the last step of migration 20261008000600_fast_task_visibility.sql,
-- which the MCP connector can't apply because it drops policies.
--
-- The write policies on these task tables were FOR ALL, so their per-row
-- checks also ran on every read and kept task lists slow. This replaces each
-- one with separate INSERT / UPDATE / DELETE policies with the same rules,
-- so reads use only the fast read policies. Safe to run more than once.
do $$
declare
  r record;
begin
  for r in
    select tablename, policyname, qual, with_check from pg_policies
    where schemaname = 'public' and cmd = 'ALL'
      and policyname in ('pm_write', 'sections_write', 'ta_write', 'tf_write', 'td_write', 'tl_write')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', r.policyname || '_insert', r.tablename, r.with_check);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', r.policyname || '_update', r.tablename, r.qual, r.with_check);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', r.policyname || '_delete', r.tablename, r.qual);
  end loop;
end $$;

-- Should list 18 policies (insert / update / delete for each of the 6 tables).
select tablename, policyname, cmd from pg_policies
where policyname like any (array['pm_write_%', 'sections_write_%', 'ta_write_%', 'tf_write_%', 'td_write_%', 'tl_write_%'])
order by tablename, policyname;
