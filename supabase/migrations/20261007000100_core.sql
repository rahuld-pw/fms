-- =============================================================================
-- Core: tenancy (organisation > campus > department), profiles, RBAC, modules,
-- fiscal / academic years, number series and generic helpers.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Internal schema: helper functions and tables that are NOT exposed through
-- PostgREST. RLS policies call into it, so authenticated/anon need USAGE.
create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Generic triggers
-- -----------------------------------------------------------------------------
create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- True for trusted server-side callers: the service role (API layer, edge
-- functions) or a direct database session without a JWT (pg_cron, migrations).
create or replace function app.is_service() returns boolean
language sql stable as $$
  select coalesce(nullif(auth.role(), ''), 'service_role') = 'service_role'
$$;

-- Who is acting? auth.uid() for end users; for service-role calls made by the
-- API layer on behalf of an API key, the request headers carry the actor.
create or replace function app.request_header(p_name text) returns text
language sql stable as $$
  select nullif(current_setting('request.headers', true), '')::json ->> p_name
$$;

create or replace function app.actor_id() returns uuid
language plpgsql stable as $$
declare
  v uuid := auth.uid();
begin
  if v is not null then return v; end if;
  if app.is_service() then
    begin
      return nullif(app.request_header('x-actor-user-id'), '')::uuid;
    exception when others then
      return null;
    end;
  end if;
  return null;
end $$;

create or replace function app.actor_type() returns text
language sql stable as $$
  select case
    when auth.uid() is not null then 'user'
    when app.request_header('x-actor-api-key-id') is not null then 'api_key'
    when app.request_header('x-actor-user-id') is not null then 'user'
    when coalesce(auth.role(), '') = 'anon' then 'anonymous'
    else 'system'
  end
$$;

-- Stamps created_by / updated_by when the table has those columns.
create or replace function app.stamp_actor() returns trigger
language plpgsql as $$
declare
  v_actor uuid := app.actor_id();
  v_row jsonb := to_jsonb(new);
begin
  if v_actor is null then return new; end if;
  if tg_op = 'INSERT' and v_row ? 'created_by' and (v_row ->> 'created_by') is null then
    new := jsonb_populate_record(new, jsonb_build_object('created_by', v_actor));
  end if;
  if v_row ? 'updated_by' then
    new := jsonb_populate_record(new, jsonb_build_object('updated_by', v_actor));
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Organisations, campuses, departments
-- -----------------------------------------------------------------------------
create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  timezone text not null default 'Asia/Kolkata',
  currency char(3) not null default 'INR',
  locale text not null default 'en-IN',
  fy_start_month smallint not null default 4 check (fy_start_month between 1 and 12),
  academic_year_start_month smallint not null default 6 check (academic_year_start_month between 1 and 12),
  logo_path text,
  -- free-form org settings (e.g. three_way_match_tolerance_pct, expense auto-approve limit)
  settings jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.campuses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  code text not null check (code ~ '^[A-Z0-9_-]{1,16}$'),
  address text,
  city text,
  state text,
  pincode text,
  gstin text,
  timezone text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, code)
);
create index on public.campuses (org_id) where deleted_at is null;

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete cascade,
  parent_id uuid references public.departments(id) on delete set null,
  name text not null,
  code text not null check (code ~ '^[A-Z0-9_-]{1,16}$'),
  head_user_id uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, campus_id, code)
);
create index on public.departments (org_id, campus_id) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- Profiles & membership
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  phone text,
  avatar_path text,
  default_org_id uuid references public.organisations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.profiles using gin (full_name extensions.gin_trgm_ops);

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

create table public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  is_owner boolean not null default false,
  title text,
  employee_code text,
  campus_id uuid references public.campuses(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  manager_id uuid references public.profiles(id) on delete set null,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index on public.org_members (user_id) where status = 'active';

alter table public.departments
  add constraint departments_head_fk foreign key (head_user_id) references public.profiles(id) on delete set null;

create table public.org_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  email text not null,
  full_name text,
  role_id uuid,
  scope_type text not null default 'org' check (scope_type in ('org', 'campus', 'department')),
  campus_id uuid references public.campuses(id) on delete cascade,
  department_id uuid references public.departments(id) on delete cascade,
  token_hash text not null unique,
  invited_by uuid references public.profiles(id),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.org_invitations (org_id, lower(email));

-- -----------------------------------------------------------------------------
-- Modules
-- -----------------------------------------------------------------------------
create table public.org_modules (
  org_id uuid not null references public.organisations(id) on delete cascade,
  module text not null check (module in ('facility', 'expense', 'tasks', 'po')),
  enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (org_id, module)
);

-- -----------------------------------------------------------------------------
-- RBAC
-- -----------------------------------------------------------------------------
create table public.permissions (
  key text primary key check (key ~ '^[a-z_]+:[a-z_]+$'),
  resource text generated always as (split_part(key, ':', 1)) stored,
  action text generated always as (split_part(key, ':', 2)) stored,
  module text check (module in ('facility', 'expense', 'tasks', 'po')),
  description text
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{2,48}$'),
  name text not null,
  description text,
  is_system boolean not null default false,
  is_superuser boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

create table public.user_role_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  scope_type text not null default 'org' check (scope_type in ('org', 'campus', 'department')),
  campus_id uuid references public.campuses(id) on delete cascade,
  department_id uuid references public.departments(id) on delete cascade,
  expires_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (
    (scope_type = 'org' and campus_id is null and department_id is null)
    or (scope_type = 'campus' and campus_id is not null and department_id is null)
    or (scope_type = 'department' and department_id is not null)
  )
);
create unique index user_role_assignments_uniq on public.user_role_assignments
  (org_id, user_id, role_id, scope_type, coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index on public.user_role_assignments (user_id, org_id);
create index on public.user_role_assignments (role_id);

alter table public.org_invitations
  add constraint org_invitations_role_fk foreign key (role_id) references public.roles(id) on delete set null;

-- Is the module (if any) that owns this permission enabled for the org?
create or replace function app.module_enabled(p_org uuid, p_module text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_module is null or coalesce(
    (select enabled from public.org_modules where org_id = p_org and module = p_module), false)
$$;

-- Scope semantics:
--   org-scoped assignment        -> applies to everything in the org
--   campus-scoped assignment     -> applies to that campus and its departments
--   department-scoped assignment -> applies to that department only
-- A target with no campus and no department is an org-level target: only
-- org-scoped assignments satisfy it (use has_permission_anywhere for resources
-- that are org-wide but may be managed by campus/department staff).
create or replace function app.has_permission(
  p_user uuid, p_permission text, p_org uuid,
  p_campus uuid default null, p_department uuid default null
) returns boolean
language sql stable security definer set search_path = public as $$
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
  ) and app.module_enabled(p_org, (select module from public.permissions where key = p_permission))
$$;

-- True when the user holds the permission at ANY scope within the org.
create or replace function app.has_permission_anywhere(p_user uuid, p_permission text, p_org uuid)
returns boolean
language sql stable security definer set search_path = public as $$
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
  ) and app.module_enabled(p_org, (select module from public.permissions where key = p_permission))
$$;

-- Convenience wrapper for RLS policies: acts as the current user. When the
-- target has no campus/department, org-wide resources are accessible to
-- holders of the permission at any scope unless p_strict.
create or replace function app.can(
  p_permission text, p_org uuid, p_campus uuid default null, p_department uuid default null,
  p_strict boolean default false
) returns boolean
language sql stable as $$
  select case
    when p_campus is null and p_department is null and not p_strict
      then app.has_permission_anywhere(auth.uid(), p_permission, p_org)
    else app.has_permission(auth.uid(), p_permission, p_org, p_campus, p_department)
  end
$$;

create or replace function app.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org and user_id = auth.uid() and status = 'active')
$$;

-- Org ids the current user belongs to (used by RLS on membership-only tables).
create or replace function app.my_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.org_members where user_id = auth.uid() and status = 'active'
$$;

-- Public RPCs used by the server helper / UI.
create or replace function public.has_permission(
  p_permission text, p_org uuid, p_campus uuid default null, p_department uuid default null
) returns boolean
language sql stable as $$
  select app.has_permission(auth.uid(), p_permission, p_org, p_campus, p_department)
$$;

create or replace function public.has_permission_anywhere(p_permission text, p_org uuid)
returns boolean language sql stable as $$
  select app.has_permission_anywhere(auth.uid(), p_permission, p_org)
$$;

-- Every permission the current user holds in an org, with its scope. The UI
-- uses this to decide what to show; enforcement still happens server-side.
create or replace function public.my_permissions(p_org uuid)
returns table (permission_key text, scope_type text, campus_id uuid, department_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct p.key, a.scope_type, a.campus_id, a.department_id
  from public.user_role_assignments a
  join public.roles r on r.id = a.role_id
  join public.org_members m on m.org_id = a.org_id and m.user_id = a.user_id and m.status = 'active'
  join public.permissions p on r.is_superuser or exists (
    select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_key = p.key)
  where a.user_id = auth.uid() and a.org_id = p_org
    and (a.expires_at is null or a.expires_at > now())
    and app.module_enabled(p_org, p.module)
$$;

-- -----------------------------------------------------------------------------
-- Standard RLS generator. Keeps hundreds of near-identical policies consistent.
--   p_resource     permission resource prefix, e.g. 'issue' -> issue:read ...
--   p_campus_col / p_dept_col  columns that place the row in the hierarchy
--   p_owner_cols   users in these columns can always read the row
--   p_owner_update owners may also update the row
--   p_strict       org-level rows require an org-scoped grant (settings etc.)
-- -----------------------------------------------------------------------------
create or replace function app.enable_standard_rls(
  p_table regclass, p_resource text,
  p_campus_col text default null, p_dept_col text default null,
  p_owner_cols text[] default '{}', p_owner_update boolean default false,
  p_strict boolean default false
) returns void
language plpgsql as $$
declare
  v_scope text;
  v_owner text := 'false';
  v_owner_upd text := case when p_owner_update then 'true' else 'false' end;
  v_col text;
begin
  v_scope := format('org_id, %s, %s, %s',
    coalesce(quote_ident(p_campus_col), 'null::uuid'),
    coalesce(quote_ident(p_dept_col), 'null::uuid'),
    case when p_strict then 'true' else 'false' end);
  foreach v_col in array p_owner_cols loop
    v_owner := v_owner || format(' or %I = (select auth.uid())', v_col);
  end loop;

  execute format('alter table %s enable row level security', p_table);
  execute format('create policy "%s_select" on %s for select to authenticated using (
      app.can(%L, %s) or (%s))', p_resource, p_table, p_resource || ':read', v_scope, v_owner);
  execute format('create policy "%s_insert" on %s for insert to authenticated with check (
      app.can(%L, %s))', p_resource, p_table, p_resource || ':create', v_scope);
  execute format('create policy "%s_update" on %s for update to authenticated using (
      app.can(%L, %s) or (%s and %s)) with check (app.can(%L, %s) or (%s and %s))',
      p_resource, p_table, p_resource || ':update', v_scope, v_owner_upd, v_owner,
      p_resource || ':update', v_scope, v_owner_upd, v_owner);
  execute format('create policy "%s_delete" on %s for delete to authenticated using (
      app.can(%L, %s))', p_resource, p_table, p_resource || ':delete', v_scope);
end $$;

-- RLS for child rows (lines, items...) that inherit access from a parent row.
-- Reading requires the parent to be visible (parent RLS applies inside the
-- subquery); writing requires update permission on the parent (or ownership).
create or replace function app.enable_child_rls(
  p_table regclass, p_parent regclass, p_fk text, p_resource text,
  p_parent_campus_col text default null, p_parent_dept_col text default null,
  p_parent_owner_cols text[] default '{}'
) returns void
language plpgsql as $$
declare
  v_owner text := 'false';
  v_col text;
  v_write text;
begin
  foreach v_col in array p_parent_owner_cols loop
    v_owner := v_owner || format(' or p.%I = (select auth.uid())', v_col);
  end loop;
  v_write := format('exists (select 1 from %s p where p.id = %I and (app.can(%L, p.org_id, %s, %s) or %s))',
    p_parent, p_fk, p_resource || ':update',
    coalesce('p.' || quote_ident(p_parent_campus_col), 'null::uuid'),
    coalesce('p.' || quote_ident(p_parent_dept_col), 'null::uuid'), v_owner);

  execute format('alter table %s enable row level security', p_table);
  execute format('create policy "child_select" on %s for select to authenticated using (
      exists (select 1 from %s p where p.id = %I))', p_table, p_parent, p_fk);
  execute format('create policy "child_insert" on %s for insert to authenticated with check (%s)', p_table, v_write);
  execute format('create policy "child_update" on %s for update to authenticated using (%s) with check (%s)',
    p_table, v_write, v_write);
  execute format('create policy "child_delete" on %s for delete to authenticated using (%s)', p_table, v_write);
end $$;

-- Attach updated_at + actor stamping triggers in one call.
create or replace function app.add_standard_triggers(p_table regclass) returns void
language plpgsql as $$
declare
  v_cols text[];
begin
  select array_agg(attname::text) into v_cols
  from pg_attribute where attrelid = p_table and attnum > 0 and not attisdropped;
  if 'updated_at' = any (v_cols) then
    execute format('create trigger set_updated_at before update on %s
      for each row execute function app.set_updated_at()', p_table);
  end if;
  if 'created_by' = any (v_cols) or 'updated_by' = any (v_cols) then
    execute format('create trigger stamp_actor before insert or update on %s
      for each row execute function app.stamp_actor()', p_table);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Fiscal & academic years
-- -----------------------------------------------------------------------------
create table public.fiscal_years (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  label text not null,                 -- e.g. 'FY 2026-27'
  start_date date not null,
  end_date date not null,
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  check (end_date > start_date),
  unique (org_id, label)
);
create index on public.fiscal_years (org_id, start_date);

create table public.academic_years (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  label text not null,                 -- e.g. 'AY 2026-27'
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  check (end_date > start_date),
  unique (org_id, label)
);

-- Short FY code for document numbers, e.g. 2026-04-15 with April start -> '26-27'.
create or replace function app.fy_code(p_org uuid, p_date date) returns text
language sql stable as $$
  with o as (select fy_start_month as m from public.organisations where id = p_org),
  y as (
    select case when extract(month from p_date) >= o.m then extract(year from p_date)::int
                else extract(year from p_date)::int - 1 end as start_year, o.m
    from o
  )
  select case when m = 1 then to_char(start_year, 'FM0000')
              else lpad((start_year % 100)::text, 2, '0') || '-' || lpad(((start_year + 1) % 100)::text, 2, '0') end
  from y
$$;

-- Returns (creating if needed) the fiscal year containing a date.
create or replace function app.fiscal_year_for(p_org uuid, p_date date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_m int;
  v_start date;
begin
  select id into v_id from public.fiscal_years
  where org_id = p_org and p_date between start_date and end_date
  order by start_date desc limit 1;
  if v_id is not null then return v_id; end if;

  select fy_start_month into v_m from public.organisations where id = p_org;
  v_start := make_date(
    case when extract(month from p_date) >= v_m then extract(year from p_date)::int
         else extract(year from p_date)::int - 1 end, v_m, 1);
  insert into public.fiscal_years (org_id, label, start_date, end_date)
  values (p_org, 'FY ' || app.fy_code(p_org, p_date), v_start, (v_start + interval '1 year' - interval '1 day')::date)
  on conflict (org_id, label) do update set label = excluded.label
  returning id into v_id;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Document number series (per org, optionally per campus and financial year)
-- format tokens: {prefix} {campus} {fy} {seq}
-- -----------------------------------------------------------------------------
create table public.number_series (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  entity_type text not null,
  campus_id uuid references public.campuses(id) on delete cascade,
  fy_code text,                          -- null = does not reset by FY
  prefix text not null,
  format text not null default '{prefix}-{seq}',
  padding smallint not null default 5 check (padding between 1 and 12),
  next_value bigint not null default 1,
  reset_each_fy boolean not null default true,
  per_campus boolean not null default false,
  updated_at timestamptz not null default now()
);
create unique index number_series_uniq on public.number_series
  (org_id, entity_type, coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(fy_code, ''));

-- Templates: one row per entity_type with campus_id/fy_code null acts as the
-- configuration; concrete counters are cloned from it per campus/FY.
create or replace function app.next_number(
  p_org uuid, p_entity_type text, p_campus uuid default null, p_date date default current_date
) returns text
language plpgsql security definer set search_path = public as $$
declare
  t public.number_series;
  v_fy text := app.fy_code(p_org, p_date);
  v_campus_code text;
  v_value bigint;
  v_defaults jsonb := '{
    "issue": "ISS", "work_order": "WO", "asset": "AST", "expense_claim": "EXP", "advance": "ADV",
    "requisition": "REQ", "rfq": "RFQ", "purchase_order": "PO", "grn": "GRN", "invoice": "INV",
    "vendor": "VEN", "payment": "PAY"}'::jsonb;
begin
  -- template row (campus null, fy null)
  select * into t from public.number_series
  where org_id = p_org and entity_type = p_entity_type and campus_id is null and fy_code is null;
  if not found then
    insert into public.number_series (org_id, entity_type, prefix, format, padding, reset_each_fy, per_campus)
    values (p_org, p_entity_type, coalesce(v_defaults ->> p_entity_type, upper(left(p_entity_type, 3))),
            case when p_entity_type = 'purchase_order' then '{prefix}/{campus}/{fy}/{seq}'
                 when p_entity_type in ('grn', 'requisition', 'invoice', 'expense_claim', 'payment', 'rfq')
                 then '{prefix}/{fy}/{seq}' else '{prefix}-{seq}' end,
            5, p_entity_type in ('purchase_order', 'grn', 'requisition', 'invoice', 'expense_claim', 'payment', 'rfq'),
            p_entity_type = 'purchase_order')
    on conflict do nothing;
    select * into t from public.number_series
    where org_id = p_org and entity_type = p_entity_type and campus_id is null and fy_code is null;
  end if;

  if not t.reset_each_fy and not t.per_campus then
    update public.number_series set next_value = next_value + 1, updated_at = now()
    where id = t.id returning next_value - 1 into v_value;
  else
    insert into public.number_series (org_id, entity_type, campus_id, fy_code, prefix, format, padding,
                                      next_value, reset_each_fy, per_campus)
    values (p_org, p_entity_type, case when t.per_campus then p_campus end,
            case when t.reset_each_fy then v_fy end, t.prefix, t.format, t.padding, 2, t.reset_each_fy, t.per_campus)
    on conflict (org_id, entity_type, coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(fy_code, ''))
    do update set next_value = public.number_series.next_value + 1, updated_at = now()
    returning next_value - 1 into v_value;
  end if;

  select code into v_campus_code from public.campuses where id = p_campus;
  return replace(replace(replace(replace(t.format,
    '{prefix}', t.prefix),
    '{campus}', coalesce(v_campus_code, 'HQ')),
    '{fy}', v_fy),
    '{seq}', lpad(v_value::text, t.padding, '0'));
end $$;

-- -----------------------------------------------------------------------------
-- RLS for core tables
-- -----------------------------------------------------------------------------
alter table public.organisations enable row level security;
create policy org_select on public.organisations for select to authenticated
  using (id in (select app.my_org_ids()));
create policy org_update on public.organisations for update to authenticated
  using (app.can('org:manage', id, null, null, true))
  with check (app.can('org:manage', id, null, null, true));

alter table public.campuses enable row level security;
create policy campus_select on public.campuses for select to authenticated
  using (org_id in (select app.my_org_ids()));
create policy campus_write on public.campuses for all to authenticated
  using (app.can('org:manage', org_id, null, null, true))
  with check (app.can('org:manage', org_id, null, null, true));

alter table public.departments enable row level security;
create policy dept_select on public.departments for select to authenticated
  using (org_id in (select app.my_org_ids()));
create policy dept_write on public.departments for all to authenticated
  using (app.can('org:manage', org_id, campus_id, null))
  with check (app.can('org:manage', org_id, campus_id, null));

alter table public.profiles enable row level security;
create policy profile_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or exists (
    select 1 from public.org_members m
    where m.user_id = profiles.id and m.org_id in (select app.my_org_ids())));
create policy profile_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter table public.org_members enable row level security;
create policy members_select on public.org_members for select to authenticated
  using (org_id in (select app.my_org_ids()) or user_id = (select auth.uid()));
create policy members_write on public.org_members for all to authenticated
  using (app.can('user:manage', org_id, null, null, true))
  with check (app.can('user:manage', org_id, null, null, true));

alter table public.org_invitations enable row level security;
create policy invitations_all on public.org_invitations for all to authenticated
  using (app.can('user:manage', org_id, null, null, true))
  with check (app.can('user:manage', org_id, null, null, true));

alter table public.org_modules enable row level security;
create policy modules_select on public.org_modules for select to authenticated
  using (org_id in (select app.my_org_ids()));
create policy modules_write on public.org_modules for all to authenticated
  using (app.can('org:manage', org_id, null, null, true))
  with check (app.can('org:manage', org_id, null, null, true));

alter table public.permissions enable row level security;
create policy permissions_select on public.permissions for select to authenticated using (true);

alter table public.roles enable row level security;
create policy roles_select on public.roles for select to authenticated
  using (org_id in (select app.my_org_ids()));
create policy roles_write on public.roles for all to authenticated
  using (app.can('role:manage', org_id, null, null, true) and not is_system)
  with check (app.can('role:manage', org_id, null, null, true) and not is_superuser);

alter table public.role_permissions enable row level security;
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id));
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and not r.is_system
                 and app.can('role:manage', r.org_id, null, null, true)))
  with check (exists (select 1 from public.roles r where r.id = role_id and not r.is_system
                 and app.can('role:manage', r.org_id, null, null, true)));

alter table public.user_role_assignments enable row level security;
create policy ura_select on public.user_role_assignments for select to authenticated
  using (user_id = (select auth.uid()) or app.can('user:read', org_id));
-- Prevent privilege escalation: only org-scoped user managers may assign roles,
-- and only org owners may hand out superuser roles.
create policy ura_write on public.user_role_assignments for all to authenticated
  using (app.can('user:manage', org_id, null, null, true))
  with check (
    app.can('user:manage', org_id, null, null, true)
    and (not exists (select 1 from public.roles r where r.id = role_id and r.is_superuser)
         or exists (select 1 from public.org_members m where m.org_id = user_role_assignments.org_id
                    and m.user_id = (select auth.uid()) and m.is_owner)));

alter table public.fiscal_years enable row level security;
create policy fy_select on public.fiscal_years for select to authenticated
  using (org_id in (select app.my_org_ids()));
create policy fy_write on public.fiscal_years for all to authenticated
  using (app.can('settings:manage', org_id, null, null, true))
  with check (app.can('settings:manage', org_id, null, null, true));

alter table public.academic_years enable row level security;
create policy ay_select on public.academic_years for select to authenticated
  using (org_id in (select app.my_org_ids()));
create policy ay_write on public.academic_years for all to authenticated
  using (app.can('settings:manage', org_id, null, null, true))
  with check (app.can('settings:manage', org_id, null, null, true));

alter table public.number_series enable row level security;
create policy ns_select on public.number_series for select to authenticated
  using (org_id in (select app.my_org_ids()));
create policy ns_write on public.number_series for all to authenticated
  using (app.can('settings:manage', org_id, null, null, true))
  with check (app.can('settings:manage', org_id, null, null, true));

select app.add_standard_triggers('public.organisations');
select app.add_standard_triggers('public.campuses');
select app.add_standard_triggers('public.departments');
select app.add_standard_triggers('public.profiles');
select app.add_standard_triggers('public.org_members');
select app.add_standard_triggers('public.roles');
