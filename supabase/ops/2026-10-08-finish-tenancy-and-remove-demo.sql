-- One-off: run once in the Supabase SQL editor (hosted project).
-- Finishes the platform_tenancy migration (functions that delete rows) and
-- removes the Greenfield demo organisation, its 8 demo users and demo API key.
-- Safe to re-run.

create or replace function app.bootstrap_modules(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.org_modules m set enabled = (m.module = any (o.licensed_modules))
  from public.organisations o where o.id = m.org_id and m.org_id = p_org;
  delete from public.approval_policies p using public.organisations o
  where o.id = p.org_id and p.org_id = p_org and o.kind = 'personal' and not (p.module = any (o.licensed_modules));
  delete from public.activity_log where org_id = p_org;
end $$;

create or replace function public.admin_remove_platform_admin(p_email text) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_email text := lower(btrim(p_email));
begin
  perform app.require_platform_admin();
  if (select count(*) from public.platform_admins) <= 1
     and exists (select 1 from public.platform_admins a join public.profiles p on p.id = a.user_id where lower(p.email) = v_email) then
    raise exception 'at least one platform admin is required' using errcode = 'P0001';
  end if;
  delete from public.platform_admin_emails where email = v_email;
  delete from public.platform_admins where user_id in (select id from public.profiles where lower(email) = v_email);
end $$;
revoke execute on function public.admin_remove_platform_admin(text) from public, anon;
grant execute on function public.admin_remove_platform_admin(text) to authenticated, service_role;

-- Demo data (the API key and everything else cascade with the organisation)
delete from public.organisations where id = '00000000-0000-4000-8000-000000000001';
delete from auth.users where email like '%@greenfield.test';

select (select count(*) from public.organisations) as organisations,
       (select count(*) from auth.users where email like '%@greenfield.test') as demo_users_left;
