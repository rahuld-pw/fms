-- =============================================================================
-- Generic approval engine
--   approval_policies        which policy applies (module, entity type, conditions)
--   approval_policy_steps    ordered steps; approver = role | user | permission |
--                            reporting_manager | department_head
--   approval_delegations     out-of-office delegation
--   approval_requests        one per submission of an entity
--   approval_request_steps   snapshot of the policy steps for that request
--   approval_actions         approve / reject / comment / cancel history
-- Modules plug in via app.approval_handlers (callback on final decision).
-- =============================================================================

create table public.approval_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  description text,
  module text not null check (module in ('facility', 'expense', 'tasks', 'po')),
  entity_type text not null,
  priority int not null default 100,       -- lower = evaluated first
  -- {"amount_min": 0, "amount_max": 50000, "category_ids": [], "department_ids": [], "campus_ids": []}
  conditions jsonb not null default '{}'::jsonb,
  auto_approve boolean not null default false,
  allow_self_approval boolean not null default false,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.approval_policies (org_id, module, entity_type, priority) where active and deleted_at is null;

create table public.approval_policy_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  policy_id uuid not null references public.approval_policies(id) on delete cascade,
  step_order int not null,
  name text not null,
  approver_type text not null check (approver_type in ('role', 'user', 'permission', 'reporting_manager', 'department_head')),
  role_id uuid references public.roles(id) on delete restrict,
  user_id uuid references public.profiles(id) on delete restrict,
  permission_key text references public.permissions(key),
  -- 'entity': role/permission must cover the entity's campus/department; 'org': any assignment in org
  scope_mode text not null default 'entity' check (scope_mode in ('entity', 'org')),
  required_approvals int not null default 1 check (required_approvals between 1 and 20),
  conditions jsonb not null default '{}'::jsonb,  -- step only applies when these match
  sla_hours int check (sla_hours > 0),
  unique (policy_id, step_order),
  check (approver_type <> 'role' or role_id is not null),
  check (approver_type <> 'user' or user_id is not null),
  check (approver_type <> 'permission' or permission_key is not null)
);

create table public.approval_delegations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  delegator_id uuid not null references public.profiles(id) on delete cascade,
  delegate_id uuid not null references public.profiles(id) on delete cascade,
  module text check (module in ('facility', 'expense', 'tasks', 'po')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  reason text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (delegator_id <> delegate_id),
  check (ends_at > starts_at)
);
create index on public.approval_delegations (org_id, delegate_id) where revoked_at is null;

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  policy_id uuid references public.approval_policies(id) on delete set null,
  module text not null,
  entity_type text not null,
  entity_id uuid not null,
  campus_id uuid references public.campuses(id),
  department_id uuid references public.departments(id),
  amount numeric(14, 2),
  currency char(3),
  category_ids uuid[] not null default '{}',
  title text not null,
  context jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  auto_approved boolean not null default false,
  current_step int,
  requested_by uuid references public.profiles(id),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index approval_requests_one_pending on public.approval_requests (entity_type, entity_id) where status = 'pending';
create index on public.approval_requests (org_id, status, submitted_at desc);
create index on public.approval_requests (entity_type, entity_id);
create index on public.approval_requests (requested_by);

create table public.approval_request_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  step_order int not null,
  name text not null,
  approver_type text not null,
  role_id uuid references public.roles(id),
  user_id uuid references public.profiles(id),
  permission_key text,
  scope_mode text not null default 'entity',
  required_approvals int not null default 1,
  conditions jsonb not null default '{}'::jsonb,
  sla_hours int,
  status text not null default 'waiting' check (status in ('waiting', 'pending', 'approved', 'rejected', 'skipped', 'cancelled')),
  activated_at timestamptz,
  due_at timestamptz,
  decided_at timestamptz,
  reminded_at timestamptz,
  note text,
  unique (request_id, step_order)
);
create index on public.approval_request_steps (org_id, status) where status = 'pending';

create table public.approval_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  step_id uuid references public.approval_request_steps(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  on_behalf_of uuid references public.profiles(id),
  action text not null check (action in ('submit', 'approve', 'reject', 'comment', 'cancel', 'auto_approve', 'skip')),
  comment text,
  created_at timestamptz not null default now()
);
create index on public.approval_actions (request_id, created_at);

-- Module callbacks: handler(request_id uuid, status text) returns void
create table app.approval_handlers (
  entity_type text primary key,
  handler regprocedure not null
);

select app.add_standard_triggers('public.approval_policies');
select app.add_standard_triggers('public.approval_requests');
select app.add_audit('public.approval_policies', 'approval_policy');

-- -----------------------------------------------------------------------------
-- Condition matching
-- -----------------------------------------------------------------------------
create or replace function app.approval_conditions_match(
  p_conditions jsonb, p_amount numeric, p_campus uuid, p_department uuid, p_categories uuid[]
) returns boolean
language sql immutable as $$
  select
    (not (p_conditions ? 'amount_min') or coalesce(p_amount, 0) >= (p_conditions ->> 'amount_min')::numeric)
    and (not (p_conditions ? 'amount_max') or coalesce(p_amount, 0) < (p_conditions ->> 'amount_max')::numeric)
    and (not (p_conditions ? 'campus_ids') or jsonb_array_length(p_conditions -> 'campus_ids') = 0
         or (p_campus is not null and p_conditions -> 'campus_ids' ? p_campus::text))
    and (not (p_conditions ? 'department_ids') or jsonb_array_length(p_conditions -> 'department_ids') = 0
         or (p_department is not null and p_conditions -> 'department_ids' ? p_department::text))
    and (not (p_conditions ? 'category_ids') or jsonb_array_length(p_conditions -> 'category_ids') = 0
         or exists (select 1 from unnest(coalesce(p_categories, '{}')) c where p_conditions -> 'category_ids' ? c::text))
$$;

-- Does a role assignment cover the request's scope?
create or replace function app.assignment_covers(
  a public.user_role_assignments, p_campus uuid, p_department uuid
) returns boolean
language sql stable as $$
  select a.scope_type = 'org'
    or (a.scope_type = 'campus' and a.campus_id = coalesce(p_campus,
          (select campus_id from public.departments where id = p_department)))
    or (a.scope_type = 'department' and a.department_id = p_department)
$$;

-- All users who are direct approvers of a request step (excluding delegation).
create or replace function app.step_approver_ids(p_step_id uuid) returns setof uuid
language plpgsql stable security definer set search_path = public, app as $$
declare
  s public.approval_request_steps;
  r public.approval_requests;
begin
  select * into s from public.approval_request_steps where id = p_step_id;
  select * into r from public.approval_requests where id = s.request_id;
  if s.approver_type in ('user', 'reporting_manager', 'department_head') then
    return query select s.user_id
      where exists (select 1 from public.org_members m where m.org_id = r.org_id and m.user_id = s.user_id and m.status = 'active');
  elsif s.approver_type = 'role' then
    return query
      select distinct a.user_id
      from public.user_role_assignments a
      join public.org_members m on m.org_id = a.org_id and m.user_id = a.user_id and m.status = 'active'
      where a.org_id = r.org_id and a.role_id = s.role_id
        and (a.expires_at is null or a.expires_at > now())
        and (s.scope_mode = 'org' or app.assignment_covers(a, r.campus_id, r.department_id));
  elsif s.approver_type = 'permission' then
    return query
      select distinct a.user_id
      from public.user_role_assignments a
      join public.roles ro on ro.id = a.role_id
      join public.org_members m on m.org_id = a.org_id and m.user_id = a.user_id and m.status = 'active'
      where a.org_id = r.org_id
        and (a.expires_at is null or a.expires_at > now())
        and (ro.is_superuser or exists (select 1 from public.role_permissions rp
                                        where rp.role_id = ro.id and rp.permission_key = s.permission_key))
        and (s.scope_mode = 'org' or app.assignment_covers(a, r.campus_id, r.department_id));
  end if;
end $$;

-- Who may act on a step, and on whose behalf? Returns the approver the actor
-- represents (themselves, or a delegator), or null when not allowed.
create or replace function app.step_acting_for(p_step_id uuid, p_actor uuid) returns uuid
language plpgsql stable security definer set search_path = public, app as $$
declare
  r public.approval_requests;
  v_for uuid;
begin
  select q.* into r from public.approval_requests q
  join public.approval_request_steps s on s.request_id = q.id where s.id = p_step_id;
  if exists (select 1 from app.step_approver_ids(p_step_id) u where u = p_actor) then
    return p_actor;
  end if;
  select d.delegator_id into v_for
  from public.approval_delegations d
  where d.org_id = r.org_id and d.delegate_id = p_actor and d.revoked_at is null
    and now() between d.starts_at and d.ends_at
    and (d.module is null or d.module = r.module)
    and d.delegator_id in (select app.step_approver_ids(p_step_id))
  limit 1;
  return v_for;
end $$;

create or replace function app.is_request_participant(p_request_id uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from public.approval_request_steps s
    where s.request_id = p_request_id and s.status in ('pending', 'approved', 'rejected')
      and app.step_acting_for(s.id, app.actor_id()) is not null)
  or exists (select 1 from public.approval_actions a where a.request_id = p_request_id and a.actor_id = app.actor_id())
$$;

-- -----------------------------------------------------------------------------
-- Engine
-- -----------------------------------------------------------------------------
create or replace function app.approval_finalize(p_request_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  r public.approval_requests;
  h regprocedure;
  reg app.entity_registry;
  v_link text;
begin
  update public.approval_requests set status = p_status, decided_at = now(), current_step = null
  where id = p_request_id returning * into r;
  update public.approval_request_steps set status = 'cancelled'
  where request_id = p_request_id and status in ('waiting', 'pending');

  select handler into h from app.approval_handlers where entity_type = r.entity_type;
  if h is not null then
    execute format('select %s($1, $2)', h::regproc) using r.id, p_status;
  end if;

  select * into reg from app.entity_registry where entity_type = r.entity_type;
  v_link := replace(coalesce(reg.url_template, ''), '{id}', r.entity_id::text);
  if p_status in ('approved', 'rejected') then
    perform app.notify(r.org_id, r.requested_by, 'approval.' || p_status,
      initcap(p_status) || ': ' || r.title, null, r.entity_type, r.entity_id, nullif(v_link, ''));
  end if;
  perform app.emit_event(r.org_id, 'approval.' || p_status, r.entity_type, r.entity_id,
    jsonb_build_object('data', to_jsonb(r)));
  perform app.log_activity(r.org_id, r.entity_type, r.entity_id, 'approval_' || p_status,
    null, jsonb_build_object('approval_request_id', r.id, 'auto', r.auto_approved));
end $$;

-- Activates the next applicable step, or finalizes as approved when none left.
create or replace function app.approval_advance(p_request_id uuid) returns text
language plpgsql security definer set search_path = public, app as $$
declare
  r public.approval_requests;
  s public.approval_request_steps;
  v_approver uuid;
  v_count int;
  reg app.entity_registry;
  v_link text;
begin
  select * into r from public.approval_requests where id = p_request_id for update;
  if r.status <> 'pending' then return r.status; end if;
  select * into reg from app.entity_registry where entity_type = r.entity_type;
  v_link := nullif(replace(coalesce(reg.url_template, ''), '{id}', r.entity_id::text), '');

  loop
    select * into s from public.approval_request_steps
    where request_id = p_request_id and status in ('waiting', 'pending')
    order by step_order limit 1;

    if not found then
      perform app.approval_finalize(p_request_id, 'approved');
      return 'approved';
    end if;

    if s.status = 'pending' then
      return 'pending';
    end if;

    if not app.approval_conditions_match(s.conditions, r.amount, r.campus_id, r.department_id, r.category_ids) then
      update public.approval_request_steps set status = 'skipped', decided_at = now(), note = 'conditions not met'
      where id = s.id;
      continue;
    end if;

    select count(*) into v_count from app.step_approver_ids(s.id);
    if v_count = 0 then
      -- No resolvable approver (e.g. requester has no manager): fall back to
      -- anyone holding <resource>:approve for the entity's scope.
      update public.approval_request_steps
      set approver_type = 'permission', permission_key = coalesce(reg.resource, 'approval') || ':approve',
          scope_mode = 'entity', note = 'no approver resolved; fell back to ' || coalesce(reg.resource, 'approval') || ':approve'
      where id = s.id returning * into s;
    end if;

    update public.approval_request_steps
    set status = 'pending', activated_at = now(),
        due_at = case when sla_hours is not null then now() + make_interval(hours => sla_hours) end
    where id = s.id returning * into s;
    update public.approval_requests set current_step = s.step_order where id = r.id;

    for v_approver in
      select distinct u from (
        select app.step_approver_ids(s.id) as u
        union
        select d.delegate_id from public.approval_delegations d
        where d.org_id = r.org_id and d.revoked_at is null and now() between d.starts_at and d.ends_at
          and (d.module is null or d.module = r.module)
          and d.delegator_id in (select app.step_approver_ids(s.id))
      ) x where u is not null and u is distinct from r.requested_by
    loop
      perform app.notify(r.org_id, v_approver, 'approval.requested', 'Approval needed: ' || r.title,
        s.name, r.entity_type, r.entity_id, v_link);
    end loop;
    perform app.emit_event(r.org_id, 'approval.step_activated', r.entity_type, r.entity_id,
      jsonb_build_object('request_id', r.id, 'step', s.step_order, 'step_name', s.name));
    return 'pending';
  end loop;
end $$;

-- Create an approval request for an entity. Called by module submit functions.
-- Returns the request id; the request may already be approved (auto-approve).
create or replace function app.approval_create(
  p_org uuid, p_module text, p_entity_type text, p_entity_id uuid,
  p_campus uuid, p_department uuid, p_amount numeric, p_category_ids uuid[],
  p_title text, p_requested_by uuid, p_context jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  p public.approval_policies;
  v_request_id uuid;
  v_manager uuid;
  v_head uuid;
  reg app.entity_registry;
  v_currency char(3);
begin
  if exists (select 1 from public.approval_requests
             where entity_type = p_entity_type and entity_id = p_entity_id and status = 'pending') then
    raise exception 'An approval is already pending for this %', p_entity_type using errcode = 'P0001';
  end if;

  select * into p from public.approval_policies
  where org_id = p_org and module = p_module and entity_type = p_entity_type and active and deleted_at is null
    and app.approval_conditions_match(conditions, p_amount, p_campus, p_department, p_category_ids)
  order by priority, created_at
  limit 1;

  select currency into v_currency from public.organisations where id = p_org;
  insert into public.approval_requests (org_id, policy_id, module, entity_type, entity_id, campus_id, department_id,
    amount, currency, category_ids, title, context, requested_by)
  values (p_org, p.id, p_module, p_entity_type, p_entity_id, p_campus, p_department, p_amount, v_currency,
    coalesce(p_category_ids, '{}'), p_title, coalesce(p_context, '{}'), p_requested_by)
  returning id into v_request_id;

  insert into public.approval_actions (org_id, request_id, actor_id, action)
  values (p_org, v_request_id, p_requested_by, 'submit');

  if p.id is not null and p.auto_approve then
    update public.approval_requests set auto_approved = true where id = v_request_id;
    insert into public.approval_actions (org_id, request_id, action, comment)
    values (p_org, v_request_id, 'auto_approve', 'Auto-approved by policy: ' || p.name);
    perform app.approval_finalize(v_request_id, 'approved');
    return v_request_id;
  end if;

  select manager_id into v_manager from public.org_members where org_id = p_org and user_id = p_requested_by;
  select head_user_id into v_head from public.departments where id = p_department;

  if p.id is null then
    -- No policy matched: single step, anyone with <resource>:approve on the entity's scope.
    select * into reg from app.entity_registry where entity_type = p_entity_type;
    insert into public.approval_request_steps (org_id, request_id, step_order, name, approver_type, permission_key, scope_mode)
    values (p_org, v_request_id, 1, 'Approval', 'permission', coalesce(reg.resource, p_module) || ':approve', 'entity');
  else
    insert into public.approval_request_steps (org_id, request_id, step_order, name, approver_type, role_id, user_id,
      permission_key, scope_mode, required_approvals, conditions, sla_hours, status)
    select p_org, v_request_id, s.step_order, s.name, s.approver_type, s.role_id,
      case s.approver_type when 'user' then s.user_id
                           when 'reporting_manager' then v_manager
                           when 'department_head' then v_head end,
      s.permission_key, s.scope_mode, s.required_approvals, s.conditions, s.sla_hours, 'waiting'
    from public.approval_policy_steps s where s.policy_id = p.id
    order by s.step_order;
    if not found then
      -- a policy with no steps approves immediately
      perform app.approval_finalize(v_request_id, 'approved');
      return v_request_id;
    end if;
  end if;

  perform app.approval_advance(v_request_id);
  return v_request_id;
end $$;

-- Approve or reject the current step of a request (end-user RPC).
create or replace function public.approval_act(p_request_id uuid, p_action text, p_comment text default null)
returns text
language plpgsql security definer set search_path = public, app as $$
declare
  r public.approval_requests;
  s public.approval_request_steps;
  p public.approval_policies;
  v_actor uuid := app.actor_id();
  v_for uuid;
  v_approvals int;
begin
  if v_actor is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_action not in ('approve', 'reject') then
    raise exception 'invalid action %', p_action using errcode = '22023';
  end if;
  select * into r from public.approval_requests where id = p_request_id for update;
  if not found then raise exception 'approval request not found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then
    raise exception 'approval request is already %', r.status using errcode = 'P0001';
  end if;
  if p_action = 'reject' and coalesce(btrim(p_comment), '') = '' then
    raise exception 'a comment is required when rejecting' using errcode = '22023';
  end if;

  select * into s from public.approval_request_steps
  where request_id = r.id and status = 'pending' order by step_order limit 1 for update;
  if not found then raise exception 'no pending step' using errcode = 'P0001'; end if;

  v_for := app.step_acting_for(s.id, v_actor);
  if v_for is null then
    raise exception 'you are not an approver for this step' using errcode = '42501';
  end if;

  select * into p from public.approval_policies where id = r.policy_id;
  if (v_actor = r.requested_by or v_for = r.requested_by) and not coalesce(p.allow_self_approval, false) then
    raise exception 'you cannot approve your own request' using errcode = '42501';
  end if;
  if exists (select 1 from public.approval_actions a where a.step_id = s.id and a.action = 'approve'
             and (a.actor_id = v_actor or a.on_behalf_of = v_for)) then
    raise exception 'you have already acted on this step' using errcode = 'P0001';
  end if;

  insert into public.approval_actions (org_id, request_id, step_id, actor_id, on_behalf_of, action, comment)
  values (r.org_id, r.id, s.id, v_actor, case when v_for <> v_actor then v_for end, p_action, p_comment);

  if p_action = 'reject' then
    update public.approval_request_steps set status = 'rejected', decided_at = now() where id = s.id;
    perform app.approval_finalize(r.id, 'rejected');
    return 'rejected';
  end if;

  select count(distinct coalesce(on_behalf_of, actor_id)) into v_approvals
  from public.approval_actions where step_id = s.id and action = 'approve';
  if v_approvals >= s.required_approvals then
    update public.approval_request_steps set status = 'approved', decided_at = now() where id = s.id;
    return app.approval_advance(r.id);
  end if;
  return 'pending';
end $$;

create or replace function public.approval_cancel(p_request_id uuid, p_comment text default null)
returns void
language plpgsql security definer set search_path = public, app as $$
declare
  r public.approval_requests;
  v_actor uuid := app.actor_id();
begin
  select * into r from public.approval_requests where id = p_request_id for update;
  if not found or r.status <> 'pending' then
    raise exception 'approval request is not pending' using errcode = 'P0001';
  end if;
  if v_actor is distinct from r.requested_by and not app.has_permission(v_actor, 'approval:manage', r.org_id) then
    raise exception 'only the requester can cancel' using errcode = '42501';
  end if;
  insert into public.approval_actions (org_id, request_id, actor_id, action, comment)
  values (r.org_id, r.id, v_actor, 'cancel', p_comment);
  perform app.approval_finalize(r.id, 'cancelled');
end $$;

create or replace function public.approval_comment(p_request_id uuid, p_comment text)
returns void
language plpgsql security definer set search_path = public, app as $$
declare
  r public.approval_requests;
begin
  select * into r from public.approval_requests where id = p_request_id;
  if not found or not (r.requested_by = app.actor_id() or app.is_request_participant(r.id)
                       or app.can_read_entity(r.entity_type, r.entity_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.approval_actions (org_id, request_id, actor_id, action, comment)
  values (r.org_id, r.id, app.actor_id(), 'comment', p_comment);
end $$;

-- Requests the current user can act on right now.
create or replace function public.approval_inbox(p_org uuid)
returns setof public.approval_requests
language sql stable security definer set search_path = public, app as $$
  select r.* from public.approval_requests r
  join public.approval_request_steps s on s.request_id = r.id and s.status = 'pending'
  where r.org_id = p_org and r.status = 'pending'
    and r.requested_by is distinct from app.actor_id()
    and app.step_acting_for(s.id, app.actor_id()) is not null
    and not exists (select 1 from public.approval_actions a where a.step_id = s.id and a.actor_id = app.actor_id())
  order by r.submitted_at
$$;

-- Reminders for overdue steps (pg_cron).
create or replace function app.approval_send_reminders() returns int
language plpgsql security definer set search_path = public, app as $$
declare
  s record;
  v_user uuid;
  n int := 0;
begin
  for s in
    select st.*, r.org_id as r_org, r.title, r.entity_type, r.entity_id
    from public.approval_request_steps st join public.approval_requests r on r.id = st.request_id
    where st.status = 'pending' and st.due_at < now()
      and (st.reminded_at is null or st.reminded_at < now() - interval '24 hours')
  loop
    for v_user in select app.step_approver_ids(s.id) loop
      perform app.notify(s.r_org, v_user, 'reminder.approval_overdue', 'Overdue approval: ' || s.title,
        s.name, s.entity_type, s.entity_id, null);
    end loop;
    update public.approval_request_steps set reminded_at = now() where id = s.id;
    perform app.emit_event(s.r_org, 'approval.overdue', s.entity_type, s.entity_id,
      jsonb_build_object('request_id', s.request_id, 'step', s.step_order));
    n := n + 1;
  end loop;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.approval_policies enable row level security;
create policy ap_select on public.approval_policies for select to authenticated
  using (org_id in (select app.my_org_ids()));
create policy ap_write on public.approval_policies for all to authenticated
  using (app.can('approval:manage', org_id, null, null, true))
  with check (app.can('approval:manage', org_id, null, null, true));

alter table public.approval_policy_steps enable row level security;
create policy aps_select on public.approval_policy_steps for select to authenticated
  using (org_id in (select app.my_org_ids()));
create policy aps_write on public.approval_policy_steps for all to authenticated
  using (app.can('approval:manage', org_id, null, null, true))
  with check (app.can('approval:manage', org_id, null, null, true));

alter table public.approval_delegations enable row level security;
create policy ad_select on public.approval_delegations for select to authenticated
  using (delegator_id = (select auth.uid()) or delegate_id = (select auth.uid())
         or app.can('approval:manage', org_id, null, null, true));
create policy ad_write on public.approval_delegations for all to authenticated
  using (delegator_id = (select auth.uid()) or app.can('approval:manage', org_id, null, null, true))
  with check ((delegator_id = (select auth.uid()) and org_id in (select app.my_org_ids()))
              or app.can('approval:manage', org_id, null, null, true));

-- Requests are created/changed only through the security definer functions.
alter table public.approval_requests enable row level security;
create policy ar_select on public.approval_requests for select to authenticated
  using (requested_by = (select auth.uid())
         or app.can('approval:manage', org_id, null, null, true)
         or app.is_request_participant(id)
         or app.can_read_entity(entity_type, entity_id));

alter table public.approval_request_steps enable row level security;
create policy ars_select on public.approval_request_steps for select to authenticated
  using (exists (select 1 from public.approval_requests r where r.id = request_id));

alter table public.approval_actions enable row level security;
create policy aa_select on public.approval_actions for select to authenticated
  using (exists (select 1 from public.approval_requests r where r.id = request_id));
