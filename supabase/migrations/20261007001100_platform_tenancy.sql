-- =============================================================================
-- Platform tenancy model
--
--   Platform super admins  create / suspend organisations and decide which
--                          modules each organisation is licensed for. They are
--                          not members of tenants and cannot read tenant data.
--   Organisation admins    manage campuses/departments (sub-organisations),
--                          users, roles and per-user module access, within
--                          the organisation's licence.
--   Public sign-ups        get a personal workspace licensed for Tasks only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Platform admins
-- -----------------------------------------------------------------------------
create table public.platform_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- Emails that become platform admins as soon as the account exists (bootstrap
-- the first super admin without anyone handling their password).
create table public.platform_admin_emails (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table public.platform_admin_emails enable row level security;

create or replace function app.is_platform_admin(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null and exists (select 1 from public.platform_admins where user_id = p_user)
$$;

create or replace function app.apply_platform_admin_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.platform_admin_emails where email = lower(new.email)) then
    insert into public.platform_admins (user_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger profiles_platform_admin after insert or update of email on public.profiles
  for each row execute function app.apply_platform_admin_email();

-- -----------------------------------------------------------------------------
-- Organisation kind, status and licence; per-member module access
-- -----------------------------------------------------------------------------
alter table public.organisations
  add column kind text not null default 'organisation' check (kind in ('organisation', 'personal')),
  add column status text not null default 'active' check (status in ('active', 'suspended')),
  add column licensed_modules text[] not null default array['facility', 'expense', 'tasks', 'po']
    check (licensed_modules <@ array['facility', 'expense', 'tasks', 'po']),
  add column plan text not null default 'standard',
  add column notes text;

-- null = every module the organisation has enabled
alter table public.org_members
  add column module_access text[] check (module_access <@ array['facility', 'expense', 'tasks', 'po']);

-- Organisation-level switch: enabled by the org admin AND licensed by the platform AND org active.
create or replace function app.org_module_enabled(p_org uuid, p_module text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_module is null or exists (
    select 1 from public.org_modules m join public.organisations o on o.id = m.org_id
    where m.org_id = p_org and m.module = p_module and m.enabled
      and o.status = 'active' and o.deleted_at is null and p_module = any (o.licensed_modules))
$$;

-- Member-level switch: the member's module list (null = all) includes the module.
create or replace function app.member_module_access(p_org uuid, p_user uuid, p_module text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_module is null or p_user is null or not exists (
    select 1 from public.org_members
    where org_id = p_org and user_id = p_user and module_access is not null and not (p_module = any (module_access)))
$$;

create or replace function app.org_active(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organisations where id = p_org and status = 'active' and deleted_at is null)
$$;

-- Every permission check passes through here, so a suspended organisation
-- grants nothing (including permission-based policies such as "for all").
create or replace function app.module_allowed(p_org uuid, p_user uuid, p_module text) returns boolean
language sql stable as $$
  select app.org_active(p_org) and app.org_module_enabled(p_org, p_module) and app.member_module_access(p_org, p_user, p_module)
$$;

-- Used directly by RLS (as the current user) and by jobs (no user: org level only).
create or replace function app.module_enabled(p_org uuid, p_module text) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.module_allowed(p_org, auth.uid(), p_module)
$$;

-- Permission checks evaluate module access for the user being checked (who may
-- not be the caller, e.g. when the approval engine resolves approvers).
create or replace function app.has_permission(
  p_user uuid, p_permission text, p_org uuid,
  p_campus uuid default null, p_department uuid default null
) returns boolean
language sql stable security definer set search_path = public, app as $$
  with target as (
    select coalesce(p_campus, (select d.campus_id from public.departments d where d.id = p_department)) as campus_id
  )
  select p_user is not null and exists (
    select 1
    from public.user_role_assignments a
    join public.roles r on r.id = a.role_id
    join public.org_members m on m.org_id = a.org_id and m.user_id = a.user_id and m.status = 'active'
    cross join target t
    where a.user_id = p_user
      and a.org_id = p_org
      and (a.expires_at is null or a.expires_at > now())
      and (r.is_superuser or exists (
        select 1 from public.role_permissions rp
        where rp.role_id = r.id and rp.permission_key = p_permission))
      and (
        a.scope_type = 'org'
        or (a.scope_type = 'campus' and t.campus_id is not null and a.campus_id = t.campus_id)
        or (a.scope_type = 'department' and p_department is not null and a.department_id = p_department)
      )
  ) and app.module_allowed(p_org, p_user, (select module from public.permissions where key = p_permission))
$$;

create or replace function app.has_permission_anywhere(p_user uuid, p_permission text, p_org uuid)
returns boolean
language sql stable security definer set search_path = public, app as $$
  select p_user is not null and exists (
    select 1
    from public.user_role_assignments a
    join public.roles r on r.id = a.role_id
    join public.org_members m on m.org_id = a.org_id and m.user_id = a.user_id and m.status = 'active'
    where a.user_id = p_user and a.org_id = p_org
      and (a.expires_at is null or a.expires_at > now())
      and (r.is_superuser or exists (
        select 1 from public.role_permissions rp
        where rp.role_id = r.id and rp.permission_key = p_permission))
  ) and app.module_allowed(p_org, p_user, (select module from public.permissions where key = p_permission))
$$;

create or replace function public.user_permissions(p_user uuid, p_org uuid)
returns table (permission_key text, scope_type text, campus_id uuid, department_id uuid)
language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.is_service() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select distinct p.key, a.scope_type, a.campus_id, a.department_id
  from public.user_role_assignments a
  join public.roles r on r.id = a.role_id
  join public.org_members m on m.org_id = a.org_id and m.user_id = a.user_id and m.status = 'active'
  join public.permissions p on r.is_superuser or exists (
    select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_key = p.key)
  where a.user_id = p_user and a.org_id = p_org
    and (a.expires_at is null or a.expires_at > now())
    and app.module_allowed(p_org, p_user, p.module);
end $$;
revoke execute on function public.user_permissions(uuid, uuid) from public, anon, authenticated;
grant execute on function public.user_permissions(uuid, uuid) to service_role;

-- Modules the given user can use in an organisation (org enabled ∩ licence ∩ member access).
create or replace function public.member_modules(p_org uuid, p_user uuid default null) returns text[]
language plpgsql stable security definer set search_path = public, app as $$
declare
  v_user uuid := coalesce(p_user, auth.uid());
begin
  if p_user is not null and p_user is distinct from auth.uid() and not app.is_service() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((select array_agg(m order by m) from unnest(array['facility', 'expense', 'tasks', 'po']) m
                   where app.module_allowed(p_org, v_user, m)), '{}');
end $$;

-- Suspended organisations disappear for their members.
create or replace function app.my_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.org_id from public.org_members m join public.organisations o on o.id = m.org_id
  where m.user_id = auth.uid() and m.status = 'active' and o.status = 'active' and o.deleted_at is null
$$;

create or replace function app.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app.my_org_ids() id where id = p_org)
$$;

-- Org admins can only switch on licensed modules; Purchasing needs Expenses.
create or replace function app.org_modules_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- new rows follow the licence quietly (bootstrap inserts every module)
  if tg_op = 'INSERT' and new.enabled and not exists (
      select 1 from public.organisations where id = new.org_id and new.module = any (licensed_modules)) then
    new.enabled := false;
    return new;
  end if;
  if new.enabled and not exists (
      select 1 from public.organisations where id = new.org_id and new.module = any (licensed_modules)) then
    raise exception 'The % module is not included in this organisation''s licence', new.module using errcode = '42501';
  end if;
  return new;
end $$;
create trigger org_modules_guard before insert or update on public.org_modules
  for each row execute function app.org_modules_guard();

create or replace function app.org_modules_dependencies() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.module = 'po' and new.enabled then
    update public.org_modules set enabled = true where org_id = new.org_id and module = 'expense' and not enabled;
  elsif new.module = 'expense' and not new.enabled then
    update public.org_modules set enabled = false where org_id = new.org_id and module = 'po' and enabled;
  end if;
  return null;
end $$;
create trigger org_modules_dependencies after insert or update of enabled on public.org_modules
  for each row execute function app.org_modules_dependencies();

-- Licence changes switch off modules that are no longer licensed.
create or replace function app.organisations_licence_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.org_modules set enabled = false
  where org_id = new.id and enabled and not (module = any (new.licensed_modules));
  return null;
end $$;
create trigger organisations_licence_sync after update of licensed_modules on public.organisations
  for each row execute function app.organisations_licence_sync();

-- Licence / status / kind are platform-controlled.
create or replace function app.organisations_platform_fields_guard() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if (new.licensed_modules is distinct from old.licensed_modules or new.status is distinct from old.status
      or new.kind is distinct from old.kind or new.plan is distinct from old.plan)
     and not app.is_platform_admin() and not app.in_system_update() and auth.uid() is not null then
    raise exception 'only a platform admin can change the licence, plan or status' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger organisations_platform_fields_guard before update on public.organisations
  for each row execute function app.organisations_platform_fields_guard();

-- -----------------------------------------------------------------------------
-- Bootstrapping organisations
-- -----------------------------------------------------------------------------
-- Org modules follow the licence on creation.
create or replace function app.bootstrap_modules(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.org_modules m set enabled = (m.module = any (o.licensed_modules))
  from public.organisations o where o.id = m.org_id and m.org_id = p_org;
  -- Personal workspaces never get more than Tasks: drop the default approval
  -- policies the bootstrap seeded for the other modules.
  delete from public.approval_policies p using public.organisations o
  where o.id = p.org_id and p.org_id = p_org and o.kind = 'personal' and not (p.module = any (o.licensed_modules));
  -- Seeding defaults is setup, not activity: keep the new feed empty.
  delete from public.activity_log where org_id = p_org;
end $$;

-- Self-service org creation is now a platform-admin action.
create or replace function public.create_organisation(
  p_name text, p_slug text, p_timezone text default 'Asia/Kolkata', p_currency text default 'INR',
  p_campus_name text default 'Main Campus', p_campus_code text default 'MAIN'
) returns uuid
language plpgsql security definer set search_path = public, app as $$
begin
  raise exception 'Organisations are created by the platform administrator' using errcode = '42501';
end $$;

-- Personal workspace for public sign-ups: Tasks only, the user is its owner.
create or replace function public.create_personal_workspace() returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_name text;
  v_email text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select o.id into v_org from public.organisations o join public.org_members m on m.org_id = o.id
  where o.kind = 'personal' and o.created_by = v_uid and m.user_id = v_uid limit 1;
  if v_org is not null then return v_org; end if;
  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)), email into v_name, v_email
  from public.profiles where id = v_uid;
  insert into public.organisations (name, slug, kind, licensed_modules, plan, created_by)
  values (left(v_name || '''s workspace', 200), 'ws-' || substr(replace(v_uid::text, '-', ''), 1, 20), 'personal',
          array['tasks'], 'personal', v_uid)
  returning id into v_org;
  insert into public.campuses (org_id, name, code) values (v_org, 'Workspace', 'WS');
  perform app.bootstrap_org(v_org, v_uid);
  perform app.bootstrap_modules(v_org);
  return v_org;
end $$;
grant execute on function public.create_personal_workspace() to authenticated;

-- Invitations that make the invitee an owner (first admin of a new organisation).
create or replace function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  i public.org_invitations;
  v_uid uuid := auth.uid();
  v_email text;
  v_staff uuid;
  v_role_key text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into i from public.org_invitations where token_hash = app.sha256(p_token) for update;
  -- opening the link again (or a prefetch that already accepted it) is fine
  if found and i.accepted_at is not null and exists (
    select 1 from public.org_members m join auth.users u on u.id = m.user_id
    where m.org_id = i.org_id and m.user_id = v_uid and m.status = 'active' and lower(u.email) = lower(i.email)
  ) then
    return i.org_id;
  end if;
  if not found or i.accepted_at is not null or i.revoked_at is not null or i.expires_at < now() then
    raise exception 'invitation is invalid or has expired' using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = v_uid;
  if lower(v_email) <> lower(i.email) then
    raise exception 'this invitation was sent to a different email address' using errcode = '42501';
  end if;
  select key into v_role_key from public.roles where id = i.role_id;
  insert into public.org_members (org_id, user_id, status, campus_id, department_id, is_owner)
  values (i.org_id, v_uid, 'active', i.campus_id, i.department_id, coalesce(v_role_key = 'owner', false))
  on conflict (org_id, user_id) do update set status = 'active',
    is_owner = public.org_members.is_owner or excluded.is_owner;
  select id into v_staff from public.roles where org_id = i.org_id and key = 'staff';
  insert into public.user_role_assignments (org_id, user_id, role_id, scope_type, created_by)
  values (i.org_id, v_uid, v_staff, 'org', i.invited_by) on conflict do nothing;
  if i.role_id is not null and i.role_id <> v_staff then
    insert into public.user_role_assignments (org_id, user_id, role_id, scope_type, campus_id, department_id, created_by)
    values (i.org_id, v_uid, i.role_id, i.scope_type,
      case when i.scope_type = 'campus' then i.campus_id end,
      case when i.scope_type = 'department' then i.department_id end, i.invited_by)
    on conflict do nothing;
  end if;
  update public.org_invitations set accepted_at = now() where id = i.id;
  -- the organisation they were invited to becomes their default (over a personal workspace)
  update public.profiles set default_org_id = case
      when default_org_id is null or exists (select 1 from public.organisations where id = default_org_id and kind = 'personal')
      then i.org_id else default_org_id end,
    full_name = coalesce(full_name, i.full_name) where id = v_uid;
  return i.org_id;
end $$;

-- Pending invitations for the signed-in user (so sign-up can route to them).
create or replace function public.my_pending_invitations()
returns table (org_name text, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.name, i.expires_at from public.org_invitations i
  join public.organisations o on o.id = i.org_id
  join auth.users u on lower(u.email) = lower(i.email)
  where u.id = auth.uid() and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
$$;
grant execute on function public.my_pending_invitations() to authenticated;

-- -----------------------------------------------------------------------------
-- Platform admin RPCs (no access to tenant data beyond counts)
-- -----------------------------------------------------------------------------
create or replace function app.require_platform_admin() returns void
language plpgsql stable security definer set search_path = public, app as $$
begin
  if not (app.is_platform_admin() or (auth.uid() is null and app.is_service())) then
    raise exception 'platform admin only' using errcode = '42501';
  end if;
end $$;

create or replace function public.admin_list_organisations(p_kind text default null)
returns table (id uuid, name text, slug text, kind text, status text, plan text, licensed_modules text[],
               enabled_modules text[], members bigint, owners text[], pending_invites bigint, created_at timestamptz, notes text)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_platform_admin();
  return query
  select o.id, o.name, o.slug, o.kind, o.status, o.plan, o.licensed_modules,
    coalesce((select array_agg(m.module order by m.module) from public.org_modules m where m.org_id = o.id and m.enabled), '{}'),
    (select count(*) from public.org_members m where m.org_id = o.id and m.status = 'active'),
    coalesce((select array_agg(p.email order by p.email) from public.org_members m join public.profiles p on p.id = m.user_id
              where m.org_id = o.id and m.is_owner), '{}'),
    (select count(*) from public.org_invitations i where i.org_id = o.id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()),
    o.created_at, o.notes
  from public.organisations o
  where o.deleted_at is null and (p_kind is null or o.kind = p_kind)
  order by o.created_at desc;
end $$;

-- Creates an organisation and an owner invitation for its first admin.
-- Returns the raw invitation token once (the server builds and emails the link).
create or replace function public.admin_create_organisation(
  p_name text, p_slug text, p_admin_email text, p_admin_name text default null,
  p_modules text[] default array['facility', 'expense', 'tasks', 'po'],
  p_timezone text default 'Asia/Kolkata', p_currency text default 'INR',
  p_campus_name text default 'Main Campus', p_campus_code text default 'MAIN', p_plan text default 'standard'
) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_org uuid;
  v_owner_role uuid;
  v_token text := replace(replace(rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='), '+', '-'), '/', '_');
  v_modules text[] := p_modules;
begin
  perform app.require_platform_admin();
  if 'po' = any (v_modules) and not ('expense' = any (v_modules)) then
    v_modules := v_modules || array['expense'];
  end if;
  insert into public.organisations (name, slug, timezone, currency, licensed_modules, plan, created_by)
  values (p_name, lower(p_slug), p_timezone, upper(p_currency), v_modules, p_plan, auth.uid())
  returning id into v_org;
  insert into public.campuses (org_id, name, code) values (v_org, p_campus_name, upper(p_campus_code));
  perform app.bootstrap_org(v_org, null);
  perform app.bootstrap_modules(v_org);
  select id into v_owner_role from public.roles where org_id = v_org and key = 'owner';
  insert into public.org_invitations (org_id, email, full_name, role_id, scope_type, token_hash, invited_by, expires_at)
  values (v_org, lower(btrim(p_admin_email)), p_admin_name, v_owner_role, 'org', app.sha256(v_token), auth.uid(), now() + interval '14 days');
  return jsonb_build_object('org_id', v_org, 'invite_token', v_token);
end $$;

create or replace function public.admin_invite_owner(p_org uuid, p_email text, p_name text default null) returns text
language plpgsql security definer set search_path = public, app as $$
declare
  v_owner_role uuid;
  v_token text := replace(replace(rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='), '+', '-'), '/', '_');
begin
  perform app.require_platform_admin();
  select id into v_owner_role from public.roles where org_id = p_org and key = 'owner';
  if v_owner_role is null then raise exception 'organisation not found' using errcode = 'P0002'; end if;
  insert into public.org_invitations (org_id, email, full_name, role_id, scope_type, token_hash, invited_by, expires_at)
  values (p_org, lower(btrim(p_email)), p_name, v_owner_role, 'org', app.sha256(v_token), auth.uid(), now() + interval '14 days');
  return v_token;
end $$;

create or replace function public.admin_update_organisation(
  p_org uuid, p_name text default null, p_status text default null, p_licensed_modules text[] default null,
  p_plan text default null, p_notes text default null
) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_modules text[] := p_licensed_modules;
begin
  perform app.require_platform_admin();
  if v_modules is not null and 'po' = any (v_modules) and not ('expense' = any (v_modules)) then
    v_modules := v_modules || array['expense'];
  end if;
  update public.organisations set
    name = coalesce(p_name, name), status = coalesce(p_status, status),
    licensed_modules = coalesce(v_modules, licensed_modules), plan = coalesce(p_plan, plan),
    notes = coalesce(p_notes, notes), updated_by = auth.uid()
  where id = p_org;
  if not found then raise exception 'organisation not found' using errcode = 'P0002'; end if;
  -- newly licensed modules are switched on
  if v_modules is not null then
    update public.org_modules set enabled = true where org_id = p_org and module = any (v_modules) and not enabled
      and module not in (select module from public.org_modules where org_id = p_org and enabled);
  end if;
end $$;

create or replace function public.admin_list_platform_admins()
returns table (user_id uuid, email text, full_name text, created_at timestamptz, pending boolean)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_platform_admin();
  return query
  select a.user_id, p.email, p.full_name, a.created_at, false from public.platform_admins a join public.profiles p on p.id = a.user_id
  union all
  select null, e.email, null, e.created_at, true from public.platform_admin_emails e
  where not exists (select 1 from public.profiles p join public.platform_admins a on a.user_id = p.id where lower(p.email) = e.email)
  order by 4;
end $$;

-- Grant by email: immediate if the account exists, otherwise on sign-up.
create or replace function public.admin_add_platform_admin(p_email text) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_email text := lower(btrim(p_email));
begin
  perform app.require_platform_admin();
  insert into public.platform_admin_emails (email) values (v_email) on conflict do nothing;
  insert into public.platform_admins (user_id, created_by)
  select id, auth.uid() from public.profiles where lower(email) = v_email on conflict do nothing;
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

-- Is the caller a platform admin? (UI routing)
create or replace function public.am_platform_admin() returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.is_platform_admin()
$$;

do $grants$
declare
  f text;
begin
  foreach f in array array[
    'public.admin_list_organisations(text)', 'public.admin_create_organisation(text, text, text, text, text[], text, text, text, text, text)',
    'public.admin_invite_owner(uuid, text, text)', 'public.admin_update_organisation(uuid, text, text, text[], text, text)',
    'public.admin_list_platform_admins()', 'public.admin_add_platform_admin(text)', 'public.admin_remove_platform_admin(text)',
    'public.am_platform_admin()', 'public.member_modules(uuid, uuid)', 'public.create_organisation(text, text, text, text, text, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end
$grants$;

-- -----------------------------------------------------------------------------
-- Product feedback: bug reports and feature requests, triaged by platform admins
-- -----------------------------------------------------------------------------
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('bug', 'feature', 'other')),
  title text not null check (length(title) between 3 and 200),
  description text not null check (length(description) between 3 and 5000),
  page_url text,
  user_agent text,
  email text,
  user_id uuid references public.profiles(id) on delete set null,
  org_id uuid references public.organisations(id) on delete set null,
  status text not null default 'new' check (status in ('new', 'triaged', 'planned', 'in_progress', 'done', 'wont_fix', 'duplicate')),
  admin_notes text,
  votes int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.feedback (status, created_at desc);
alter table public.feedback enable row level security;
create policy feedback_own_or_admin on public.feedback for select to authenticated
  using (user_id = (select auth.uid()) or app.is_platform_admin());
create policy feedback_admin_update on public.feedback for update to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
create trigger feedback_updated_at before update on public.feedback for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Deleting an organisation cascades to its rows; skip audit entries for an
-- organisation that is going away (they would reference a deleted org).
-- -----------------------------------------------------------------------------
create or replace function app.audit_trigger() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_action text;
  v_ignored text[] := array['updated_at', 'updated_by', 'search_vector', 'created_at', 'tracking_token_hash',
                            'key_hash', 'secret', 'token_hash', 'invite_token_hash'];
begin
  if tg_op = 'INSERT' then
    perform app.log_activity(new.org_id, tg_argv[0], new.id, 'created', null);
    return new;
  elsif tg_op = 'DELETE' then
    if not exists (select 1 from public.organisations where id = old.org_id) then return old; end if;
    perform app.log_activity(old.org_id, tg_argv[0], old.id, 'deleted', null);
    return old;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  for v_key in select jsonb_object_keys(v_new) loop
    if v_key = any (v_ignored) then continue; end if;
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_array(v_old -> v_key, v_new -> v_key));
    end if;
  end loop;
  if v_changes = '{}'::jsonb then return new; end if;

  v_action := case
    when v_changes ? 'deleted_at' and (v_new ->> 'deleted_at') is not null then 'deleted'
    when v_changes ? 'deleted_at' then 'restored'
    when v_changes ? 'status' then 'status_changed'
    else 'updated' end;
  perform app.log_activity(new.org_id, tg_argv[0], new.id, v_action, v_changes);
  return new;
end $$;
