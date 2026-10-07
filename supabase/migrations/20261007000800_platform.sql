-- =============================================================================
-- Platform: permission catalogue, default roles & org bootstrap, invitations,
-- global search, dashboards, reminders/expiry alerts, storage, cron, grants.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permission catalogue
-- -----------------------------------------------------------------------------
insert into public.permissions (key, module, description) values
  -- core
  ('org:manage', null, 'Manage organisation profile, campuses, departments and modules'),
  ('settings:manage', null, 'Manage settings: SLAs, number series, fiscal years, custom fields'),
  ('user:read', null, 'View users and their roles'),
  ('user:manage', null, 'Invite users and assign roles'),
  ('role:manage', null, 'Create and edit roles'),
  ('audit:read', null, 'View the full audit trail'),
  ('api_key:manage', null, 'Create and revoke API keys'),
  ('webhook:manage', null, 'Manage outbound webhooks'),
  ('approval:manage', null, 'Manage approval policies and override requests'),
  ('attachment:manage', null, 'Remove any attachment'),
  -- facility
  ('location:read', 'facility', 'View locations'),
  ('location:create', 'facility', 'Create locations'),
  ('location:update', 'facility', 'Edit locations'),
  ('location:delete', 'facility', 'Delete locations'),
  ('issue:read', 'facility', 'View all issues in scope'),
  ('issue:report', 'facility', 'Report issues'),
  ('issue:create', 'facility', 'Create issues on behalf of others'),
  ('issue:update', 'facility', 'Triage, assign and update issues'),
  ('issue:delete', 'facility', 'Delete issues'),
  ('issue:configure', 'facility', 'Manage issue categories'),
  ('issue:escalation', 'facility', 'Receive issue escalations'),
  ('asset:read', 'facility', 'View assets'),
  ('asset:create', 'facility', 'Create and import assets'),
  ('asset:update', 'facility', 'Edit assets'),
  ('asset:delete', 'facility', 'Delete or dispose assets'),
  ('asset:transfer', 'facility', 'Transfer assets'),
  ('asset:configure', 'facility', 'Manage asset categories'),
  ('asset_audit:read', 'facility', 'View asset verification audits'),
  ('asset_audit:create', 'facility', 'Plan asset verification audits'),
  ('asset_audit:update', 'facility', 'Perform asset verification'),
  ('asset_audit:delete', 'facility', 'Delete asset audits'),
  ('vendor:read', 'facility', 'View vendors'),
  ('vendor:create', 'facility', 'Create and invite vendors'),
  ('vendor:update', 'facility', 'Edit and verify vendors'),
  ('vendor:delete', 'facility', 'Delete vendors'),
  ('vendor:approve', 'facility', 'Approve vendor onboarding'),
  ('vendor:rate', 'facility', 'Rate vendors'),
  ('work_order:read', 'facility', 'View work orders'),
  ('work_order:create', 'facility', 'Create work orders'),
  ('work_order:update', 'facility', 'Update any work order'),
  ('work_order:delete', 'facility', 'Delete work orders'),
  ('pm:read', 'facility', 'View preventive maintenance'),
  ('pm:create', 'facility', 'Create PM schedules'),
  ('pm:update', 'facility', 'Edit PM schedules and checklists'),
  ('pm:delete', 'facility', 'Delete PM schedules'),
  ('amc:read', 'facility', 'View AMC contracts'),
  ('amc:create', 'facility', 'Create AMC contracts'),
  ('amc:update', 'facility', 'Edit AMC contracts'),
  ('amc:delete', 'facility', 'Delete AMC contracts'),
  ('compliance:read', 'facility', 'View compliance calendar'),
  ('compliance:create', 'facility', 'Create compliance items'),
  ('compliance:update', 'facility', 'Edit compliance items'),
  ('compliance:delete', 'facility', 'Delete compliance items'),
  -- expense
  ('expense:read', 'expense', 'View expense claims and advances in scope'),
  ('expense:submit', 'expense', 'Submit own expense claims and advances'),
  ('expense:create', 'expense', 'Create claims on behalf of others'),
  ('expense:update', 'expense', 'Edit claims in scope'),
  ('expense:delete', 'expense', 'Delete claims'),
  ('expense:approve', 'expense', 'Approve expense claims and advances'),
  ('expense:pay', 'expense', 'Mark claims as paid and disburse advances'),
  ('budget:read', 'expense', 'View budgets'),
  ('budget:create', 'expense', 'Create budget lines'),
  ('budget:update', 'expense', 'Edit budget lines and request amendments'),
  ('budget:delete', 'expense', 'Delete budget lines'),
  ('budget:manage', 'expense', 'Manage categories and carry-forward'),
  ('budget:approve', 'expense', 'Approve budget amendments'),
  ('petty_cash:read', 'expense', 'View petty cash'),
  ('petty_cash:create', 'expense', 'Create petty cash funds'),
  ('petty_cash:update', 'expense', 'Top up and adjust petty cash'),
  ('petty_cash:delete', 'expense', 'Delete petty cash funds'),
  -- tasks
  ('task:read', 'tasks', 'View org-visible projects'),
  ('task:create', 'tasks', 'Create tasks'),
  ('task:update', 'tasks', 'Edit tasks in visible projects'),
  ('project:create', 'tasks', 'Create projects and templates'),
  ('project:manage', 'tasks', 'Manage all projects'),
  ('team:manage', 'tasks', 'Manage teams'),
  -- po
  ('requisition:read', 'po', 'View requisitions in scope'),
  ('requisition:submit', 'po', 'Raise own requisitions'),
  ('requisition:create', 'po', 'Create requisitions for others'),
  ('requisition:update', 'po', 'Edit requisitions'),
  ('requisition:delete', 'po', 'Delete requisitions'),
  ('requisition:approve', 'po', 'Approve requisitions'),
  ('rfq:read', 'po', 'View RFQs and quotes'),
  ('rfq:create', 'po', 'Create RFQs'),
  ('rfq:update', 'po', 'Record quotes'),
  ('rfq:delete', 'po', 'Delete RFQs'),
  ('rfq:award', 'po', 'Award quotes'),
  ('po:read', 'po', 'View purchase orders'),
  ('po:create', 'po', 'Create purchase orders and items'),
  ('po:update', 'po', 'Edit draft purchase orders'),
  ('po:delete', 'po', 'Delete draft purchase orders'),
  ('po:approve', 'po', 'Approve purchase orders'),
  ('po:send', 'po', 'Send purchase orders to vendors'),
  ('po:amend', 'po', 'Amend approved purchase orders'),
  ('po:cancel', 'po', 'Cancel purchase orders'),
  ('po:close', 'po', 'Close purchase orders'),
  ('grn:read', 'po', 'View goods receipts'),
  ('grn:create', 'po', 'Receive goods'),
  ('grn:update', 'po', 'Edit draft goods receipts'),
  ('grn:delete', 'po', 'Delete draft goods receipts'),
  ('invoice:read', 'po', 'View vendor invoices'),
  ('invoice:create', 'po', 'Record vendor invoices'),
  ('invoice:update', 'po', 'Edit vendor invoices'),
  ('invoice:delete', 'po', 'Delete vendor invoices'),
  ('invoice:approve', 'po', 'Approve invoices for payment'),
  ('invoice:override', 'po', 'Override 3-way match failures'),
  ('payment:create', 'po', 'Record payments')
on conflict (key) do update set module = excluded.module, description = excluded.description;

-- -----------------------------------------------------------------------------
-- Default roles + org bootstrap
-- -----------------------------------------------------------------------------
create or replace function app.default_role_definitions() returns jsonb
language sql immutable as $$
  select '{
    "owner": {"name": "Owner", "superuser": true, "description": "Full access, can grant any role", "permissions": []},
    "admin": {"name": "Administrator", "superuser": true, "description": "Full access to all modules and settings", "permissions": []},
    "staff": {"name": "Staff", "description": "Default role for every member", "permissions": [
      "location:read", "issue:report", "expense:submit", "requisition:submit", "task:read", "task:create",
      "task:update", "project:create", "vendor:read", "budget:read"]},
    "facility_manager": {"name": "Facility Manager", "description": "Runs facilities: issues, assets, vendors, maintenance", "permissions": [
      "location:read", "location:create", "location:update", "location:delete",
      "issue:read", "issue:report", "issue:create", "issue:update", "issue:configure", "issue:escalation",
      "asset:read", "asset:create", "asset:update", "asset:transfer", "asset:configure", "asset:delete",
      "asset_audit:read", "asset_audit:create", "asset_audit:update",
      "vendor:read", "vendor:create", "vendor:update", "vendor:approve", "vendor:rate",
      "work_order:read", "work_order:create", "work_order:update",
      "pm:read", "pm:create", "pm:update", "pm:delete", "amc:read", "amc:create", "amc:update",
      "compliance:read", "compliance:create", "compliance:update",
      "requisition:read", "requisition:submit", "grn:read", "grn:create", "po:read", "expense:submit"]},
    "technician": {"name": "Technician", "description": "Works on assigned issues and work orders", "permissions": [
      "location:read", "issue:report", "issue:read", "work_order:read", "asset:read", "pm:read", "asset_audit:read",
      "asset_audit:update", "compliance:read", "expense:submit"]},
    "finance_manager": {"name": "Finance Manager", "description": "Budgets, expenses, invoices and payments", "permissions": [
      "expense:read", "expense:submit", "expense:create", "expense:update", "expense:approve", "expense:pay",
      "budget:read", "budget:create", "budget:update", "budget:manage", "budget:approve",
      "petty_cash:read", "petty_cash:create", "petty_cash:update",
      "po:read", "po:approve", "grn:read", "invoice:read", "invoice:create", "invoice:update", "invoice:approve",
      "invoice:override", "payment:create", "vendor:read", "vendor:approve", "requisition:read", "rfq:read", "amc:read"]},
    "procurement_officer": {"name": "Procurement Officer", "description": "Requisitions, RFQs, POs, receipts", "permissions": [
      "requisition:read", "requisition:submit", "requisition:create", "requisition:update",
      "rfq:read", "rfq:create", "rfq:update", "rfq:award",
      "po:read", "po:create", "po:update", "po:delete", "po:send", "po:amend", "po:cancel", "po:close",
      "grn:read", "grn:create", "grn:update", "invoice:read", "invoice:create", "invoice:update",
      "vendor:read", "vendor:create", "vendor:update", "vendor:rate", "budget:read", "asset:create", "asset:read"]},
    "department_head": {"name": "Department Head", "description": "Approves spending for their department", "permissions": [
      "expense:read", "expense:submit", "expense:approve", "budget:read", "budget:update",
      "requisition:read", "requisition:submit", "requisition:approve", "po:read", "po:approve",
      "issue:read", "issue:report", "asset:read", "task:read", "task:create", "task:update", "project:create"]},
    "auditor": {"name": "Auditor", "description": "Read-only access including the audit trail", "permissions": [
      "audit:read", "user:read", "location:read", "issue:read", "asset:read", "asset_audit:read", "vendor:read",
      "work_order:read", "pm:read", "amc:read", "compliance:read", "expense:read", "budget:read", "petty_cash:read",
      "requisition:read", "rfq:read", "po:read", "grn:read", "invoice:read", "task:read"]}
  }'::jsonb
$$;

create or replace function app.bootstrap_org(p_org uuid, p_owner uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_key text;
  v_def jsonb;
  v_role uuid;
  v_owner_role uuid;
  v_staff_role uuid;
  v_fin_role uuid;
  v_fm_role uuid;
  v_policy uuid;
  m text;
begin
  for v_key, v_def in select * from jsonb_each(app.default_role_definitions()) loop
    insert into public.roles (org_id, key, name, description, is_system, is_superuser)
    values (p_org, v_key, v_def ->> 'name', v_def ->> 'description', v_key in ('owner', 'admin'),
            coalesce((v_def ->> 'superuser')::boolean, false))
    on conflict (org_id, key) do update set name = excluded.name
    returning id into v_role;
    insert into public.role_permissions (role_id, permission_key)
    select v_role, jsonb_array_elements_text(v_def -> 'permissions')
    on conflict do nothing;
  end loop;

  foreach m in array array['facility', 'expense', 'tasks', 'po'] loop
    insert into public.org_modules (org_id, module, enabled) values (p_org, m, true) on conflict do nothing;
  end loop;

  insert into public.sla_policies (org_id, priority, response_minutes, resolution_minutes) values
    (p_org, 'critical', 30, 240), (p_org, 'high', 120, 1440), (p_org, 'medium', 240, 2880), (p_org, 'low', 1440, 7200)
  on conflict do nothing;

  perform app.fiscal_year_for(p_org, current_date);

  select id into v_owner_role from public.roles where org_id = p_org and key = 'owner';
  select id into v_staff_role from public.roles where org_id = p_org and key = 'staff';
  select id into v_fin_role from public.roles where org_id = p_org and key = 'finance_manager';
  select id into v_fm_role from public.roles where org_id = p_org and key = 'facility_manager';

  if p_owner is not null then
    insert into public.org_members (org_id, user_id, status, is_owner) values (p_org, p_owner, 'active', true)
    on conflict (org_id, user_id) do update set is_owner = true, status = 'active';
    insert into public.user_role_assignments (org_id, user_id, role_id, scope_type)
    values (p_org, p_owner, v_owner_role, 'org'), (p_org, p_owner, v_staff_role, 'org')
    on conflict do nothing;
    update public.profiles set default_org_id = coalesce(default_org_id, p_org) where id = p_owner;
  end if;

  -- Sensible default approval policies (editable in Settings > Approvals).
  if not exists (select 1 from public.approval_policies where org_id = p_org) then
    insert into public.approval_policies (org_id, name, module, entity_type, priority, conditions, auto_approve)
    values (p_org, 'Small claims auto-approve', 'expense', 'expense_claim', 10, '{"amount_max": 2000}', true);

    insert into public.approval_policies (org_id, name, module, entity_type, priority, conditions)
    values (p_org, 'Expense claims', 'expense', 'expense_claim', 20, '{"amount_min": 2000}') returning id into v_policy;
    insert into public.approval_policy_steps (org_id, policy_id, step_order, name, approver_type, conditions, sla_hours) values
      (p_org, v_policy, 1, 'Reporting manager', 'reporting_manager', '{}', 48);
    insert into public.approval_policy_steps (org_id, policy_id, step_order, name, approver_type, role_id, conditions, sla_hours) values
      (p_org, v_policy, 2, 'Finance', 'role', v_fin_role, '{"amount_min": 25000}', 48);

    insert into public.approval_policies (org_id, name, module, entity_type, priority, conditions)
    values (p_org, 'Advances', 'expense', 'expense_advance', 10, '{}') returning id into v_policy;
    insert into public.approval_policy_steps (org_id, policy_id, step_order, name, approver_type, sla_hours) values
      (p_org, v_policy, 1, 'Reporting manager', 'reporting_manager', 48);
    insert into public.approval_policy_steps (org_id, policy_id, step_order, name, approver_type, role_id, sla_hours) values
      (p_org, v_policy, 2, 'Finance', 'role', v_fin_role, 48);

    insert into public.approval_policies (org_id, name, module, entity_type, priority, conditions)
    values (p_org, 'Requisitions', 'po', 'requisition', 10, '{}') returning id into v_policy;
    insert into public.approval_policy_steps (org_id, policy_id, step_order, name, approver_type, permission_key, sla_hours) values
      (p_org, v_policy, 1, 'Department approval', 'permission', 'requisition:approve', 48);

    insert into public.approval_policies (org_id, name, module, entity_type, priority, conditions)
    values (p_org, 'Purchase orders', 'po', 'purchase_order', 10, '{}') returning id into v_policy;
    insert into public.approval_policy_steps (org_id, policy_id, step_order, name, approver_type, permission_key, conditions, sla_hours) values
      (p_org, v_policy, 1, 'Department head', 'permission', 'po:approve', '{}', 48);
    insert into public.approval_policy_steps (org_id, policy_id, step_order, name, approver_type, role_id, conditions, sla_hours) values
      (p_org, v_policy, 2, 'Finance', 'role', v_fin_role, '{"amount_min": 100000}', 72);

    insert into public.approval_policies (org_id, name, module, entity_type, priority, conditions)
    values (p_org, 'Vendor onboarding', 'facility', 'vendor', 10, '{}') returning id into v_policy;
    insert into public.approval_policy_steps (org_id, policy_id, step_order, name, approver_type, permission_key, scope_mode, sla_hours) values
      (p_org, v_policy, 1, 'Vendor approval', 'permission', 'vendor:approve', 'org', 72);

    insert into public.approval_policies (org_id, name, module, entity_type, priority, conditions)
    values (p_org, 'Budget amendments', 'expense', 'budget_amendment', 10, '{}') returning id into v_policy;
    insert into public.approval_policy_steps (org_id, policy_id, step_order, name, approver_type, permission_key, sla_hours) values
      (p_org, v_policy, 1, 'Finance', 'permission', 'budget:approve', 72);
  end if;
end $$;

-- Self-service org creation (sign-up flow).
create or replace function public.create_organisation(
  p_name text, p_slug text, p_timezone text default 'Asia/Kolkata', p_currency text default 'INR',
  p_campus_name text default 'Main Campus', p_campus_code text default 'MAIN'
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  v_org uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if (select count(*) from public.org_members where user_id = v_uid and is_owner) >= 5 then
    raise exception 'organisation limit reached' using errcode = 'P0001';
  end if;
  insert into public.organisations (name, slug, timezone, currency, created_by)
  values (p_name, lower(p_slug), p_timezone, upper(p_currency), v_uid) returning id into v_org;
  insert into public.campuses (org_id, name, code) values (v_org, p_campus_name, upper(p_campus_code));
  perform app.bootstrap_org(v_org, v_uid);
  return v_org;
end $$;

-- Accept an invitation (token is the raw token from the invite link).
create or replace function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  i public.org_invitations;
  v_uid uuid := auth.uid();
  v_email text;
  v_staff uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into i from public.org_invitations where token_hash = app.sha256(p_token) for update;
  if not found or i.accepted_at is not null or i.revoked_at is not null or i.expires_at < now() then
    raise exception 'invitation is invalid or has expired' using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = v_uid;
  if lower(v_email) <> lower(i.email) then
    raise exception 'this invitation was sent to a different email address' using errcode = '42501';
  end if;
  insert into public.org_members (org_id, user_id, status, campus_id, department_id)
  values (i.org_id, v_uid, 'active', i.campus_id, i.department_id)
  on conflict (org_id, user_id) do update set status = 'active';
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
  update public.profiles set default_org_id = coalesce(default_org_id, i.org_id),
    full_name = coalesce(full_name, i.full_name) where id = v_uid;
  return i.org_id;
end $$;

-- -----------------------------------------------------------------------------
-- Global search (security invoker: RLS decides what each user sees)
-- -----------------------------------------------------------------------------
create or replace function public.global_search(p_org uuid, p_query text, p_limit int default 20)
returns table (entity_type text, id uuid, title text, subtitle text, url text, rank real)
language sql stable security invoker as $$
  with q as (select btrim(p_query) as s, '%' || btrim(p_query) || '%' as l)
  select * from (
    select 'issue'::text, i.id, i.title, i.number || ' · ' || i.status, '/facility/issues/' || i.id,
      greatest(extensions.similarity(i.title, q.s), case when i.number ilike q.l then 1 else 0 end)::real
    from public.issues i, q where i.org_id = p_org and i.deleted_at is null and (i.title ilike q.l or i.number ilike q.l)
    union all
    select 'asset', a.id, a.name, a.asset_tag || coalesce(' · ' || a.serial_number, ''), '/facility/assets/' || a.id,
      greatest(extensions.similarity(a.name, q.s), case when a.asset_tag ilike q.l or a.serial_number ilike q.l then 1 else 0 end)::real
    from public.assets a, q where a.org_id = p_org and a.deleted_at is null
      and (a.name ilike q.l or a.asset_tag ilike q.l or a.serial_number ilike q.l)
    union all
    select 'vendor', v.id, v.name, coalesce(v.gstin, v.status), '/facility/vendors/' || v.id,
      greatest(extensions.similarity(v.name, q.s), case when v.gstin ilike q.l then 1 else 0 end)::real
    from public.vendors v, q where v.org_id = p_org and v.deleted_at is null and (v.name ilike q.l or v.gstin ilike q.l)
    union all
    select 'location', l.id, l.name, array_to_string(l.path_names, ' / '), '/facility/locations/' || l.id,
      extensions.similarity(l.name, q.s)::real
    from public.locations l, q where l.org_id = p_org and l.deleted_at is null and (l.name ilike q.l or l.code ilike q.l)
    union all
    select 'work_order', w.id, w.title, w.number || ' · ' || w.status, '/facility/work-orders/' || w.id,
      greatest(extensions.similarity(w.title, q.s), case when w.number ilike q.l then 1 else 0 end)::real
    from public.work_orders w, q where w.org_id = p_org and w.deleted_at is null and (w.title ilike q.l or w.number ilike q.l)
    union all
    select 'expense_claim', c.id, c.title, c.number || ' · ' || c.status, '/expense/claims/' || c.id,
      greatest(extensions.similarity(c.title, q.s), case when c.number ilike q.l then 1 else 0 end)::real
    from public.expense_claims c, q where c.org_id = p_org and c.deleted_at is null and (c.title ilike q.l or c.number ilike q.l)
    union all
    select 'purchase_order', p.id, p.number, (select name from public.vendors where id = p.vendor_id) || ' · ' || p.status,
      '/po/orders/' || p.id, 1::real
    from public.purchase_orders p, q where p.org_id = p_org and p.deleted_at is null and p.number ilike q.l
    union all
    select 'requisition', r.id, r.title, r.number || ' · ' || r.status, '/po/requisitions/' || r.id,
      greatest(extensions.similarity(r.title, q.s), case when r.number ilike q.l then 1 else 0 end)::real
    from public.requisitions r, q where r.org_id = p_org and r.deleted_at is null and (r.title ilike q.l or r.number ilike q.l)
    union all
    select 'task', t.id, t.title, t.status, '/tasks/t/' || t.id, extensions.similarity(t.title, q.s)::real
    from public.tasks t, q where t.org_id = p_org and t.deleted_at is null and t.title ilike q.l
    union all
    select 'project', p.id, p.name, p.status, '/tasks/projects/' || p.id, extensions.similarity(p.name, q.s)::real
    from public.projects p, q where p.org_id = p_org and p.deleted_at is null and not p.is_template and p.name ilike q.l
  ) x (entity_type, id, title, subtitle, url, rank)
  where length((select s from q)) >= 2
  order by rank desc, title
  limit least(greatest(p_limit, 1), 50)
$$;

-- -----------------------------------------------------------------------------
-- Dashboards
-- -----------------------------------------------------------------------------
create or replace function public.facility_dashboard(p_org uuid, p_campus uuid default null)
returns jsonb
language sql stable security invoker as $$
  select jsonb_build_object(
    'issues_by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (
        select status, count(*) n from public.issues where org_id = p_org and deleted_at is null
          and (p_campus is null or campus_id = p_campus) and created_at > now() - interval '90 days' group by status) x),
    'open_by_priority', (select coalesce(jsonb_object_agg(priority, n), '{}') from (
        select priority, count(*) n from public.issues where org_id = p_org and deleted_at is null
          and (p_campus is null or campus_id = p_campus)
          and status not in ('resolved', 'closed', 'cancelled') group by priority) x),
    'sla_breached', (select count(*) from public.issues where org_id = p_org and deleted_at is null
          and (p_campus is null or campus_id = p_campus)
          and status not in ('resolved', 'closed', 'cancelled') and resolution_due_at < now()),
    'sla_met_pct_30d', (select round(100.0 * count(*) filter (where resolved_at <= resolution_due_at) / nullif(count(*), 0), 1)
          from public.issues where org_id = p_org and resolved_at > now() - interval '30 days'
          and (p_campus is null or campus_id = p_campus)),
    'avg_resolution_hours_30d', (select round(extract(epoch from avg(resolved_at - created_at)) / 3600, 1)
          from public.issues where org_id = p_org and resolved_at > now() - interval '30 days'
          and (p_campus is null or campus_id = p_campus)),
    'avg_rating_90d', (select round(avg(rating), 2) from public.issues where org_id = p_org and rating is not null
          and feedback_at > now() - interval '90 days'),
    'work_orders_open', (select count(*) from public.work_orders where org_id = p_org and deleted_at is null
          and (p_campus is null or campus_id = p_campus) and status not in ('completed', 'verified', 'cancelled')),
    'work_orders_overdue', (select count(*) from public.work_orders where org_id = p_org and deleted_at is null
          and (p_campus is null or campus_id = p_campus) and status not in ('completed', 'verified', 'cancelled') and due_at < now()),
    'pm_completion_pct_90d', (select round(100.0 * count(*) filter (where status in ('completed', 'verified')) / nullif(count(*), 0), 1)
          from public.work_orders where org_id = p_org and type = 'preventive' and due_at between now() - interval '90 days' and now()
          and (p_campus is null or campus_id = p_campus)),
    'assets_by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (
          select status, count(*) n from public.assets where org_id = p_org and deleted_at is null
          and (p_campus is null or campus_id = p_campus) group by status) x),
    'compliance_due_30d', (select count(*) from public.compliance_items where org_id = p_org and deleted_at is null
          and (p_campus is null or campus_id = p_campus) and next_due_on <= current_date + 30),
    'compliance_overdue', (select count(*) from public.compliance_items where org_id = p_org and deleted_at is null
          and (p_campus is null or campus_id = p_campus) and next_due_on < current_date),
    'issues_trend', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'opened', o, 'resolved', r) order by d), '[]') from (
          select g::date d,
            (select count(*) from public.issues i where i.org_id = p_org and i.created_at::date = g::date
               and (p_campus is null or i.campus_id = p_campus)) o,
            (select count(*) from public.issues i where i.org_id = p_org and i.resolved_at::date = g::date
               and (p_campus is null or i.campus_id = p_campus)) r
          from generate_series(current_date - 29, current_date, interval '1 day') g) x)
  )
$$;

create or replace function public.po_dashboard(p_org uuid)
returns jsonb
language sql stable security invoker as $$
  select jsonb_build_object(
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (
        select status, count(*) n from public.purchase_orders where org_id = p_org and deleted_at is null group by status) x),
    'open_value', (select coalesce(sum(total), 0) from public.purchase_orders where org_id = p_org and deleted_at is null
        and status in ('approved', 'sent', 'acknowledged', 'partially_received', 'received')),
    'pending_approval', (select count(*) from public.purchase_orders where org_id = p_org and status = 'pending_approval'),
    'invoices_pending', (select count(*) from public.vendor_invoices where org_id = p_org and status = 'received'),
    'invoices_mismatch', (select count(*) from public.vendor_invoices where org_id = p_org and status = 'received'
        and match_status in ('qty_mismatch', 'price_mismatch', 'over_billed')),
    'payables_overdue', (select coalesce(sum(total - amount_paid), 0) from public.vendor_invoices where org_id = p_org
        and status in ('approved', 'partially_paid') and due_date < current_date),
    'top_vendors', (select coalesce(jsonb_agg(x order by x.spend desc), '[]') from (
        select v.id, v.name, sum(p.total) spend, count(*) orders from public.purchase_orders p
        join public.vendors v on v.id = p.vendor_id
        where p.org_id = p_org and p.status not in ('draft', 'rejected', 'cancelled', 'pending_approval')
          and p.order_date > current_date - 365
        group by v.id, v.name order by spend desc limit 10) x),
    'requisitions_pending', (select count(*) from public.requisitions where org_id = p_org and status = 'pending_approval')
  )
$$;

create or replace function public.home_dashboard(p_org uuid)
returns jsonb
language sql stable security invoker as $$
  select jsonb_build_object(
    'my_tasks_open', (select count(*) from public.tasks t join public.task_assignees a on a.task_id = t.id
        where a.user_id = auth.uid() and t.org_id = p_org and t.deleted_at is null and t.status not in ('done', 'cancelled')),
    'my_tasks_overdue', (select count(*) from public.tasks t join public.task_assignees a on a.task_id = t.id
        where a.user_id = auth.uid() and t.org_id = p_org and t.deleted_at is null and t.status not in ('done', 'cancelled')
        and t.due_date < current_date),
    'my_tasks_due_soon', (select count(*) from public.tasks t join public.task_assignees a on a.task_id = t.id
        where a.user_id = auth.uid() and t.org_id = p_org and t.deleted_at is null and t.status not in ('done', 'cancelled')
        and t.due_date between current_date and current_date + 3),
    'my_approvals', (select count(*) from public.approval_inbox(p_org)),
    'my_issues_open', (select count(*) from public.issues where org_id = p_org and deleted_at is null
        and (reporter_id = auth.uid() or assignee_id = auth.uid()) and status not in ('resolved', 'closed', 'cancelled')),
    'my_work_orders_open', (select count(*) from public.work_orders where org_id = p_org and deleted_at is null
        and assignee_id = auth.uid() and status not in ('completed', 'verified', 'cancelled')),
    'my_claims_pending', (select count(*) from public.expense_claims where org_id = p_org and deleted_at is null
        and claimant_id = auth.uid() and status in ('draft', 'pending_approval', 'approved')),
    'unread_notifications', (select count(*) from public.notifications where org_id = p_org and user_id = auth.uid()
        and read_at is null)
  )
$$;

-- -----------------------------------------------------------------------------
-- Reminders & expiry alerts (pg_cron daily)
-- -----------------------------------------------------------------------------
create or replace function app.users_with_permission(p_org uuid, p_permission text, p_campus uuid default null)
returns setof uuid
language sql stable security definer set search_path = public, app as $$
  select distinct a.user_id
  from public.user_role_assignments a
  join public.roles r on r.id = a.role_id
  join public.org_members m on m.org_id = a.org_id and m.user_id = a.user_id and m.status = 'active'
  where a.org_id = p_org and (a.expires_at is null or a.expires_at > now())
    and ((r.is_superuser and r.key <> 'owner')
         or exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_key = p_permission))
    and (a.scope_type = 'org' or (p_campus is not null and a.scope_type = 'campus' and a.campus_id = p_campus))
$$;

create or replace function app.alert_once(
  p_org uuid, p_users uuid[], p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid,
  p_link text, p_bucket text
) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_user uuid;
begin
  -- dedupe per entity/type/bucket (e.g. '30d', '7d', 'due') via the message outbox key
  if exists (select 1 from public.message_outbox where org_id = p_org
             and dedupe_key = p_type || ':' || p_entity_id || ':' || p_bucket) then
    return;
  end if;
  insert into public.message_outbox (org_id, channel, recipient, template, subject, payload, dedupe_key, status)
  values (p_org, 'email', 'internal', 'alert_marker', p_title, '{}'::jsonb, p_type || ':' || p_entity_id || ':' || p_bucket, 'skipped');
  foreach v_user in array p_users loop
    perform app.notify(p_org, v_user, p_type, p_title, p_body, p_entity_type, p_entity_id, p_link);
  end loop;
end $$;

create or replace function app.send_expiry_alerts(p_today date default current_date) returns int
language plpgsql security definer set search_path = public, app as $$
declare
  r record;
  n int := 0;
  v_bucket text;
begin
  -- vendor documents
  for r in
    select d.*, v.name as vendor_name from public.vendor_documents d join public.vendors v on v.id = d.vendor_id
    where d.expires_on is not null and d.expires_on <= p_today + 30 and v.deleted_at is null
      and v.status not in ('inactive', 'blacklisted') and app.module_enabled(d.org_id, 'facility')
  loop
    v_bucket := case when r.expires_on < p_today then 'expired' when r.expires_on <= p_today + 7 then '7d' else '30d' end;
    perform app.alert_once(r.org_id, array(select app.users_with_permission(r.org_id, 'vendor:update')),
      'reminder.vendor_document_expiry', r.vendor_name || ': ' || replace(r.doc_type, '_', ' ') ||
        case when r.expires_on < p_today then ' expired' else ' expires ' || to_char(r.expires_on, 'DD Mon YYYY') end,
      null, 'vendor', r.vendor_id, '/facility/vendors/' || r.vendor_id, v_bucket);
    n := n + 1;
  end loop;

  -- vendor agreements
  for r in
    select a.*, v.name as vendor_name from public.vendor_agreements a join public.vendors v on v.id = a.vendor_id
    where a.status = 'active' and a.end_date is not null and a.end_date <= p_today + a.renewal_reminder_days
      and app.module_enabled(a.org_id, 'facility')
  loop
    if r.end_date < p_today and not r.auto_renew then
      update public.vendor_agreements set status = 'expired' where id = r.id;
    end if;
    v_bucket := case when r.end_date < p_today then 'expired' when r.end_date <= p_today + 7 then '7d' else 'window' end;
    perform app.alert_once(r.org_id, array(select app.users_with_permission(r.org_id, 'vendor:update')),
      'reminder.agreement_renewal', 'Agreement renewal: ' || r.title || ' (' || r.vendor_name || ')',
      'Ends ' || to_char(r.end_date, 'DD Mon YYYY'), 'vendor', r.vendor_id, '/facility/vendors/' || r.vendor_id, v_bucket);
    n := n + 1;
  end loop;

  -- asset warranties
  for r in
    select * from public.assets where deleted_at is null and status <> 'disposed' and warranty_until is not null
      and warranty_until between p_today and p_today + 30 and app.module_enabled(org_id, 'facility')
  loop
    perform app.alert_once(r.org_id, array(select app.users_with_permission(r.org_id, 'asset:update', r.campus_id)),
      'reminder.warranty_expiry', 'Warranty expiring: ' || r.name || ' (' || r.asset_tag || ')',
      'Warranty ends ' || to_char(r.warranty_until, 'DD Mon YYYY'), 'asset', r.id, '/facility/assets/' || r.id,
      case when r.warranty_until <= p_today + 7 then '7d' else '30d' end);
    n := n + 1;
  end loop;

  -- AMC renewals
  for r in
    select c.*, v.name as vendor_name from public.amc_contracts c join public.vendors v on v.id = c.vendor_id
    where c.deleted_at is null and c.status = 'active' and c.end_date <= p_today + c.renewal_reminder_days
      and app.module_enabled(c.org_id, 'facility')
  loop
    if r.end_date < p_today then
      update public.amc_contracts set status = 'expired' where id = r.id;
    end if;
    perform app.alert_once(r.org_id, array(select app.users_with_permission(r.org_id, 'amc:update', r.campus_id)),
      'reminder.amc_renewal', 'AMC renewal: ' || r.title || ' (' || r.vendor_name || ')',
      'Ends ' || to_char(r.end_date, 'DD Mon YYYY'), 'amc_contract', r.id, '/facility/amc/' || r.id,
      case when r.end_date < p_today then 'expired' when r.end_date <= p_today + 7 then '7d' else 'window' end);
    n := n + 1;
  end loop;

  -- statutory compliance (also queues a WhatsApp-ready message for the responsible person)
  for r in
    select c.*, p.phone, p.full_name from public.compliance_items c left join public.profiles p on p.id = c.responsible_user_id
    where c.deleted_at is null and c.next_due_on <= p_today + c.reminder_days and app.module_enabled(c.org_id, 'facility')
  loop
    v_bucket := case when r.next_due_on < p_today then 'overdue:' || p_today
                     when r.next_due_on <= p_today + 7 then '7d' else 'window' end;
    perform app.alert_once(r.org_id,
      array(select app.users_with_permission(r.org_id, 'compliance:update', r.campus_id)) ||
        case when r.responsible_user_id is not null then array[r.responsible_user_id] else '{}'::uuid[] end,
      'reminder.compliance_due', 'Compliance due: ' || r.title,
      case when r.next_due_on < p_today then 'Overdue since ' else 'Due ' end || to_char(r.next_due_on, 'DD Mon YYYY'),
      'compliance_item', r.id, '/facility/compliance/' || r.id, v_bucket);
    if r.phone is not null then
      perform app.queue_message(r.org_id, 'whatsapp', r.phone, 'compliance_due', null,
        jsonb_build_object('name', r.full_name, 'title', r.title, 'due', r.next_due_on),
        'wa:compliance:' || r.id || ':' || v_bucket);
    end if;
    n := n + 1;
  end loop;

  -- vendor bookings awaiting confirmation for work orders scheduled in the next 2 days
  for r in
    select w.*, v.email as vendor_email, v.phone as vendor_phone, v.name as vendor_name
    from public.work_orders w join public.vendors v on v.id = w.vendor_id
    where w.deleted_at is null and w.vendor_booking_status in ('requested', 'rescheduled')
      and w.scheduled_for between now() and now() + interval '2 days'
  loop
    perform app.queue_message(r.org_id, 'email', r.vendor_email, 'vendor_booking_reminder',
      'Please confirm visit: ' || r.title, jsonb_build_object('work_order_id', r.id, 'number', r.number,
        'scheduled_for', r.scheduled_for, 'vendor_id', r.vendor_id), 'booking:' || r.id || ':' || r.scheduled_for::date);
    perform app.queue_message(r.org_id, 'whatsapp', r.vendor_phone, 'vendor_booking_reminder', null,
      jsonb_build_object('work_order_id', r.id, 'number', r.number, 'scheduled_for', r.scheduled_for),
      'wa:booking:' || r.id || ':' || r.scheduled_for::date);
  end loop;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Storage: private bucket, objects stored under <org_id>/<entity_type>/<entity_id>/<file>
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400), ('org-public', 'org-public', true, 2097152)
on conflict (id) do nothing;

create policy "attachments read via attachment rows" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and exists (select 1 from public.attachments a where a.bucket = 'attachments' and a.path = name));
create policy "attachments upload into own org" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1]::uuid in (select app.my_org_ids()));
create policy "org-public read" on storage.objects for select to anon, authenticated using (bucket_id = 'org-public');
create policy "org-public upload by org admins" on storage.objects for insert to authenticated
  with check (bucket_id = 'org-public' and app.can('org:manage', (storage.foldername(name))[1]::uuid, null, null, true));

-- Permissions of any user (service role only; used to evaluate API keys
-- against the permissions of the user who created them).
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
    and app.module_enabled(p_org, p.module);
end $$;
revoke execute on function public.user_permissions(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Hardening: functions in public are exposed via PostgREST; anon gets nothing
-- (public endpoints go through the API with the service role). Service-only
-- functions are re-granted to service_role.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from anon;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public revoke execute on functions from anon;
revoke all on schema app from anon;

-- budget_check is called internally by submit flows; end users may call it only
-- for orgs they belong to and when they can spend or read budgets.
create or replace function public.budget_check_for_user(
  p_org uuid, p_date date, p_campus uuid, p_department uuid, p_category uuid, p_amount numeric
) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
begin
  if not (app.has_permission_anywhere(auth.uid(), 'budget:read', p_org)
          or app.has_permission_anywhere(auth.uid(), 'expense:submit', p_org)
          or app.has_permission_anywhere(auth.uid(), 'requisition:submit', p_org)
          or app.has_permission_anywhere(auth.uid(), 'po:create', p_org)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return public.budget_check(p_org, p_date, p_campus, p_department, p_category, p_amount);
end $$;
revoke execute on function public.budget_check(uuid, date, uuid, uuid, uuid, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.budget_check(uuid, date, uuid, uuid, uuid, numeric, text, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Scheduled jobs (only when pg_cron is available, i.e. on Supabase)
-- Webhook/message dispatch is driven by pg_net calling the edge functions; it
-- needs Vault secrets project_url and dispatch_token (see 20261007000900_dispatch_auth.sql).
-- -----------------------------------------------------------------------------
do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('escalate-issues', '*/5 * * * *', 'select app.escalate_issues()');
    perform cron.schedule('approval-reminders', '15 * * * *', 'select app.approval_send_reminders()');
    perform cron.schedule('pm-work-orders', '30 0 * * *', 'select app.generate_pm_work_orders()');
    perform cron.schedule('expiry-alerts', '0 3 * * *', 'select app.send_expiry_alerts()');
    perform cron.schedule('recurring-expenses', '45 0 * * *', 'select app.run_recurring_expenses()');
    perform cron.schedule('task-due-reminders', '0 2 * * *', 'select app.task_due_reminders()');
    perform cron.schedule('cleanup-ephemeral', '20 * * * *', 'select app.cleanup_ephemeral()');
    if exists (select 1 from pg_available_extensions where name = 'pg_net') then
      create extension if not exists pg_net;
      perform cron.schedule('dispatch-webhooks', '* * * * *', $job$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/dispatch-webhooks',
          headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
                                        'Content-Type', 'application/json'),
          body := '{}'::jsonb)
        where exists (select 1 from public.webhook_deliveries where status in ('pending', 'failed') and next_attempt_at <= now())
      $job$);
      perform cron.schedule('dispatch-messages', '* * * * *', $job$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/dispatch-messages',
          headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
                                        'Content-Type', 'application/json'),
          body := '{}'::jsonb)
        where exists (select 1 from public.message_outbox where status = 'pending' and send_after <= now())
      $job$);
    end if;
  end if;
end
$cron$;

-- Realtime: in-app notifications and task boards update live.
do $rt$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications, public.tasks, public.comments;
  end if;
end
$rt$;
