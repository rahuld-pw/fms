-- -----------------------------------------------------------------------------
-- Functions get EXECUTE for PUBLIC by default, which the anonymous role
-- inherits. Nothing in this schema is meant for anonymous callers (public
-- pages go through the server with the service role), so replace the PUBLIC
-- grant with explicit grants to signed-in users and the service role.
-- Functions that were already restricted (no PUBLIC grant) are left alone;
-- extension-owned functions are skipped.
-- -----------------------------------------------------------------------------
do $privs$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
      and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  loop
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
    execute format('revoke execute on function %s from public', f.sig);
  end loop;
end
$privs$;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema app revoke execute on functions from public;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
alter default privileges in schema app grant execute on functions to authenticated, service_role;
