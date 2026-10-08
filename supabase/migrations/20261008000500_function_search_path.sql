-- Pin search_path on the functions in public / app that don't set one
-- (Supabase linter 0011). Objects resolve exactly as before: public, app and
-- extensions.
--
-- Deliberately left out: app.can. It is a plain SQL wrapper that row-level
-- security inlines into ~165 policies; any SET clause stops inlining and made
-- list queries about 10x slower. It is SECURITY INVOKER and only calls
-- schema-qualified functions (auth.uid(), app.has_permission*, which pin
-- their own search_path), so a mutable search_path gives no privilege.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prokind in ('f', 'p')
      and p.oid::regprocedure::text not like 'app.can(%'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, app, extensions', f.sig);
  end loop;
end $$;
