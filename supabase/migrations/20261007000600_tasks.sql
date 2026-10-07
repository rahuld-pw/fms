-- =============================================================================
-- Task Management (Asana-inspired): teams > projects > sections > tasks >
-- subtasks, multiple assignees, followers, dependencies, recurrence,
-- templates, links to other entities and progress roll-ups.
-- =============================================================================

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete set null,
  name text not null,
  description text,
  color text not null default 'green',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.teams (org_id) where deleted_at is null;

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'lead')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index on public.team_members (user_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  name text not null,
  description text,
  color text not null default 'green',
  icon text,
  status text not null default 'active' check (status in ('active', 'on_hold', 'completed', 'archived')),
  health text check (health in ('on_track', 'at_risk', 'off_track')),
  visibility text not null default 'team' check (visibility in ('org', 'team', 'private')),
  default_view text not null default 'list' check (default_view in ('list', 'board', 'calendar', 'timeline')),
  owner_id uuid references public.profiles(id) on delete set null,
  start_date date,
  due_date date,
  is_template boolean not null default false,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.projects (org_id, team_id) where deleted_at is null;

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  role text not null default 'editor' check (role in ('viewer', 'commenter', 'editor', 'admin')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index on public.project_members (user_id);

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.sections (project_id, position);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,      -- null = personal (My Tasks)
  section_id uuid references public.sections(id) on delete set null,
  parent_task_id uuid references public.tasks(id) on delete cascade,
  title text not null check (length(title) between 1 and 500),
  description text,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  start_date date,
  due_date date,
  due_time time,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id),
  position double precision not null default 0,
  estimated_hours numeric(8, 2),
  -- {"freq": "daily|weekly|monthly|yearly", "interval": 1, "until": "2027-03-31"}
  recurrence jsonb,
  recurrence_source_id uuid references public.tasks(id) on delete set null,
  is_milestone boolean not null default false,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (due_date is null or start_date is null or due_date >= start_date)
);
create index on public.tasks (project_id, section_id, position) where deleted_at is null;
create index on public.tasks (parent_task_id) where deleted_at is null;
create index on public.tasks (org_id, due_date) where deleted_at is null and status not in ('done', 'cancelled');
create index on public.tasks (created_by);
create index on public.tasks using gin (title extensions.gin_trgm_ops);

create table public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index on public.task_assignees (user_id);

create table public.task_followers (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index on public.task_followers (user_id);

create table public.task_dependencies (
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);
create index on public.task_dependencies (depends_on_task_id);

create table public.task_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  entity_type text not null check (entity_type in ('issue', 'work_order', 'purchase_order', 'requisition',
    'asset', 'vendor', 'expense_claim')),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique (task_id, entity_type, entity_id)
);
create index on public.task_links (entity_type, entity_id);

create table public.task_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  description text,
  -- {"title": "...", "description": "...", "priority": "medium", "due_in_days": 7,
  --  "subtasks": [{"title": "...", "due_in_days": 2}]}
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Visibility helpers (security definer => no RLS recursion)
-- -----------------------------------------------------------------------------
-- Row-based checks are used by SELECT policies (the row being inserted is not
-- yet visible to a lookup by id during INSERT ... RETURNING).
create or replace function app.project_visible(
  p_org uuid, p_id uuid, p_owner uuid, p_created_by uuid, p_visibility text, p_team uuid
) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.module_enabled(p_org, 'tasks') and (
    p_owner = auth.uid() or p_created_by = auth.uid()
    or exists (select 1 from public.project_members pm where pm.project_id = p_id and pm.user_id = auth.uid())
    or (p_visibility = 'org' and app.has_permission_anywhere(auth.uid(), 'task:read', p_org))
    or (p_visibility = 'team' and exists (select 1 from public.team_members tm
                                          where tm.team_id = p_team and tm.user_id = auth.uid()))
    or app.has_permission(auth.uid(), 'project:manage', p_org))
$$;

create or replace function app.can_read_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select coalesce((select app.project_visible(p.org_id, p.id, p.owner_id, p.created_by, p.visibility, p.team_id)
                   from public.projects p where p.id = p_project_id), false)
$$;

create or replace function app.can_edit_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id and app.module_enabled(p.org_id, 'tasks')
      and (app.has_permission(auth.uid(), 'project:manage', p.org_id)
        or p.owner_id = auth.uid() or p.created_by = auth.uid()
        or exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = auth.uid()
                   and pm.role in ('editor', 'admin'))
        or (p.visibility <> 'private' and exists (select 1 from public.team_members tm
                   where tm.team_id = p.team_id and tm.user_id = auth.uid() and tm.role = 'lead'))))
$$;

create or replace function app.task_visible(
  p_org uuid, p_id uuid, p_project uuid, p_parent uuid, p_created_by uuid
) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.module_enabled(p_org, 'tasks') and (
    p_created_by = auth.uid()
    or exists (select 1 from public.task_assignees a where a.task_id = p_id and a.user_id = auth.uid())
    or exists (select 1 from public.task_followers f where f.task_id = p_id and f.user_id = auth.uid())
    or (p_project is not null and app.can_read_project(p_project))
    or (p_parent is not null and exists (
          select 1 from public.task_assignees a where a.task_id = p_parent and a.user_id = auth.uid()))
    or app.has_permission(auth.uid(), 'project:manage', p_org))
$$;

create or replace function app.can_read_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select coalesce((select app.task_visible(t.org_id, t.id, t.project_id, t.parent_task_id, t.created_by)
                   from public.tasks t where t.id = p_task_id), false)
$$;

create or replace function app.can_edit_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id and app.module_enabled(t.org_id, 'tasks')
      and (t.created_by = auth.uid()
        or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = auth.uid())
        or (t.project_id is not null and app.can_read_project(t.project_id)
            and app.has_permission_anywhere(auth.uid(), 'task:update', t.org_id))
        or (t.project_id is not null and app.can_edit_project(t.project_id))
        or app.has_permission(auth.uid(), 'project:manage', t.org_id)))
$$;

create or replace function app.can_read_task_entity(p_entity_type text, p_entity_id uuid)
returns boolean language sql stable security definer set search_path = public, app as $$
  select case p_entity_type
    when 'task' then app.can_read_task(p_entity_id)
    when 'project' then app.can_read_project(p_entity_id)
    else false end
$$;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
create or replace function app.tasks_before() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  p public.tasks;
begin
  if new.parent_task_id is not null then
    select * into p from public.tasks where id = new.parent_task_id;
    if p.parent_task_id is not null and (select parent_task_id from public.tasks where id = p.parent_task_id) is not null then
      raise exception 'subtasks can be nested at most 3 levels' using errcode = '23514';
    end if;
    new.project_id := coalesce(new.project_id, p.project_id);
  end if;
  if new.section_id is not null and not exists (
    select 1 from public.sections where id = new.section_id and project_id is not distinct from new.project_id) then
    new.section_id := null;
  end if;
  if tg_op = 'INSERT' and new.position = 0 then
    new.position := coalesce((select max(position) from public.tasks
                              where project_id is not distinct from new.project_id
                                and section_id is not distinct from new.section_id
                                and parent_task_id is not distinct from new.parent_task_id), 0) + 1024;
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
    new.completed_by := app.actor_id();
  elsif new.status <> 'done' then
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end $$;
create trigger tasks_before before insert or update on public.tasks
  for each row execute function app.tasks_before();

-- Completing a recurring task schedules the next occurrence; notify followers.
create or replace function app.tasks_after() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_next date;
  v_new uuid;
  v_freq text;
  v_interval int;
  v_user uuid;
begin
  if new.status = 'done' and old.status <> 'done' then
    if new.recurrence is not null and new.due_date is not null then
      v_freq := new.recurrence ->> 'freq';
      v_interval := coalesce((new.recurrence ->> 'interval')::int, 1);
      v_next := case v_freq
        when 'daily' then new.due_date + v_interval
        when 'weekly' then new.due_date + 7 * v_interval
        when 'monthly' then (new.due_date + make_interval(months => v_interval))::date
        when 'yearly' then (new.due_date + make_interval(years => v_interval))::date end;
      if v_next is not null and (new.recurrence ->> 'until' is null or v_next <= (new.recurrence ->> 'until')::date) then
        insert into public.tasks (org_id, project_id, section_id, parent_task_id, title, description, priority,
          start_date, due_date, due_time, recurrence, recurrence_source_id, created_by, estimated_hours)
        values (new.org_id, new.project_id, new.section_id, new.parent_task_id, new.title, new.description, new.priority,
          case when new.start_date is not null then v_next - (new.due_date - new.start_date) end, v_next, new.due_time,
          new.recurrence, coalesce(new.recurrence_source_id, new.id), new.created_by, new.estimated_hours)
        returning id into v_new;
        insert into public.task_assignees (task_id, user_id, org_id)
        select v_new, user_id, org_id from public.task_assignees where task_id = new.id;
        insert into public.task_followers (task_id, user_id, org_id)
        select v_new, user_id, org_id from public.task_followers where task_id = new.id
        on conflict do nothing;
        -- stop recurrence on the completed instance so it is not re-spawned on reopen
        update public.tasks set recurrence = null where id = new.id;
      end if;
    end if;
    for v_user in
      select user_id from public.task_followers where task_id = new.id
      union select new.created_by where new.created_by is not null
    loop
      perform app.notify(new.org_id, v_user, 'task.completed', 'Completed: ' || new.title, null,
        'task', new.id, '/tasks/t/' || new.id);
    end loop;
  end if;
  return null;
end $$;
create trigger tasks_after after update of status on public.tasks
  for each row execute function app.tasks_after();

create or replace function app.task_assignees_after() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = new.task_id;
  perform app.notify(new.org_id, new.user_id, 'task.assigned', 'Assigned to you: ' || t.title,
    case when t.due_date is not null then 'Due ' || to_char(t.due_date, 'DD Mon YYYY') end,
    'task', t.id, '/tasks/t/' || t.id);
  insert into public.task_followers (task_id, user_id, org_id) values (new.task_id, new.user_id, new.org_id)
  on conflict do nothing;
  return null;
end $$;
create trigger task_assignees_after after insert on public.task_assignees
  for each row execute function app.task_assignees_after();

-- Reject dependency cycles.
create or replace function app.task_dependencies_check() returns trigger
language plpgsql as $$
begin
  if exists (
    with recursive chain(id) as (
      select new.depends_on_task_id
      union
      select d.depends_on_task_id from public.task_dependencies d join chain c on d.task_id = c.id
    ) select 1 from chain where id = new.task_id) then
    raise exception 'dependency would create a cycle' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger task_dependencies_check before insert on public.task_dependencies
  for each row execute function app.task_dependencies_check();

-- Create a project (sections + tasks with relative dates) from a template project.
create or replace function public.project_from_template(
  p_template_id uuid, p_name text, p_team_id uuid default null, p_start_date date default current_date
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  t public.projects;
  v_project uuid;
  v_offset int;
begin
  select * into t from public.projects where id = p_template_id and is_template;
  if not found or not app.can_read_project(t.id) then raise exception 'template not found' using errcode = 'P0002'; end if;
  if not app.has_permission_anywhere(auth.uid(), 'project:create', t.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_offset := p_start_date - coalesce(t.start_date, p_start_date);
  insert into public.projects (org_id, team_id, name, description, color, icon, visibility, default_view, owner_id,
    start_date, due_date, created_by)
  values (t.org_id, coalesce(p_team_id, t.team_id), p_name, t.description, t.color, t.icon, t.visibility,
    t.default_view, auth.uid(), p_start_date, t.due_date + v_offset, auth.uid())
  returning id into v_project;
  insert into public.project_members (project_id, user_id, org_id, role) values (v_project, auth.uid(), t.org_id, 'admin');

  create temporary table _section_map on commit drop as
    select s.id as old_id, gen_random_uuid() as new_id, s.name, s.position from public.sections s where s.project_id = t.id;
  insert into public.sections (id, org_id, project_id, name, position)
  select new_id, t.org_id, v_project, name, position from _section_map;

  create temporary table _task_map on commit drop as
    select x.id as old_id, gen_random_uuid() as new_id from public.tasks x where x.project_id = t.id and x.deleted_at is null;
  insert into public.tasks (id, org_id, project_id, section_id, parent_task_id, title, description, priority,
    start_date, due_date, position, estimated_hours, is_milestone, created_by)
  select m.new_id, t.org_id, v_project, sm.new_id, pm.new_id, x.title, x.description, x.priority,
    x.start_date + v_offset, x.due_date + v_offset, x.position, x.estimated_hours, x.is_milestone, auth.uid()
  from public.tasks x
  join _task_map m on m.old_id = x.id
  left join _section_map sm on sm.old_id = x.section_id
  left join _task_map pm on pm.old_id = x.parent_task_id
  order by x.parent_task_id nulls first;
  insert into public.task_dependencies (task_id, depends_on_task_id, org_id)
  select a.new_id, b.new_id, t.org_id from public.task_dependencies d
  join _task_map a on a.old_id = d.task_id join _task_map b on b.old_id = d.depends_on_task_id;
  return v_project;
end $$;

-- Create a task (with subtasks) from a task template.
create or replace function public.task_from_template(
  p_template_id uuid, p_project_id uuid default null, p_section_id uuid default null, p_start date default current_date
) returns uuid
language plpgsql security invoker as $$
declare
  t public.task_templates;
  v_task uuid;
  s jsonb;
begin
  select * into t from public.task_templates where id = p_template_id;
  if not found then raise exception 'template not found' using errcode = 'P0002'; end if;
  insert into public.tasks (org_id, project_id, section_id, title, description, priority, due_date, created_by)
  values (t.org_id, p_project_id, p_section_id, coalesce(t.payload ->> 'title', t.name), t.payload ->> 'description',
    coalesce(t.payload ->> 'priority', 'medium'),
    case when t.payload ? 'due_in_days' then p_start + (t.payload ->> 'due_in_days')::int end, auth.uid())
  returning id into v_task;
  for s in select * from jsonb_array_elements(coalesce(t.payload -> 'subtasks', '[]'::jsonb)) loop
    insert into public.tasks (org_id, project_id, parent_task_id, title, due_date, created_by)
    values (t.org_id, p_project_id, v_task, s ->> 'title',
      case when s ? 'due_in_days' then p_start + (s ->> 'due_in_days')::int end, auth.uid());
  end loop;
  return v_task;
end $$;

-- Due-soon reminders (pg_cron daily)
create or replace function app.task_due_reminders(p_today date default current_date) returns int
language plpgsql security definer set search_path = public, app as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select t.id, t.org_id, t.title, t.due_date, a.user_id
    from public.tasks t join public.task_assignees a on a.task_id = t.id
    where t.deleted_at is null and t.status not in ('done', 'cancelled')
      and t.due_date in (p_today, p_today + 1)
      and app.module_enabled(t.org_id, 'tasks')
  loop
    perform app.notify(r.org_id, r.user_id, 'reminder.task_due',
      case when r.due_date = p_today then 'Due today: ' else 'Due tomorrow: ' end || r.title,
      null, 'task', r.id, '/tasks/t/' || r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Roll-ups
-- -----------------------------------------------------------------------------
create or replace view public.project_progress
with (security_invoker = true) as
select p.id as project_id, p.org_id, p.team_id, p.name, p.status, p.due_date,
  count(t.id) as total_tasks,
  count(t.id) filter (where t.status = 'done') as completed_tasks,
  count(t.id) filter (where t.status not in ('done', 'cancelled') and t.due_date < current_date) as overdue_tasks,
  count(t.id) filter (where t.status = 'in_progress') as in_progress_tasks,
  case when count(t.id) filter (where t.status <> 'cancelled') = 0 then 0
       else round(100.0 * count(t.id) filter (where t.status = 'done')
                  / count(t.id) filter (where t.status <> 'cancelled'), 1) end as progress_pct
from public.projects p
left join public.tasks t on t.project_id = p.id and t.parent_task_id is null and t.deleted_at is null
where p.deleted_at is null and not p.is_template
group by p.id;

create or replace function public.task_rollup(p_org uuid)
returns table (level text, id uuid, name text, total_tasks bigint, completed_tasks bigint, overdue_tasks bigint, progress_pct numeric)
language sql stable security invoker as $$
  with pp as (select * from public.project_progress where org_id = p_org)
  select 'project', project_id, name, total_tasks, completed_tasks, overdue_tasks, progress_pct from pp
  union all
  select 'team', tm.id, tm.name, sum(pp.total_tasks)::bigint, sum(pp.completed_tasks)::bigint, sum(pp.overdue_tasks)::bigint,
    case when sum(pp.total_tasks) = 0 then 0 else round(100.0 * sum(pp.completed_tasks) / sum(pp.total_tasks), 1) end
  from pp join public.teams tm on tm.id = pp.team_id group by tm.id, tm.name
  union all
  select 'org', p_org, 'Organisation', sum(total_tasks)::bigint, sum(completed_tasks)::bigint, sum(overdue_tasks)::bigint,
    case when sum(total_tasks) = 0 then 0 else round(100.0 * sum(completed_tasks) / sum(total_tasks), 1) end
  from pp
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
create or replace function app.is_team_lead(p_team uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from public.team_members where team_id = p_team and user_id = auth.uid() and role = 'lead')
$$;

alter table public.teams enable row level security;
create policy teams_select on public.teams for select to authenticated
  using (org_id in (select app.my_org_ids()) and app.module_enabled(org_id, 'tasks'));
create policy teams_insert on public.teams for insert to authenticated
  with check (app.can('team:manage', org_id));
create policy teams_update on public.teams for update to authenticated
  using (app.can('team:manage', org_id) or app.is_team_lead(id))
  with check (app.can('team:manage', org_id) or app.is_team_lead(id));
create policy teams_delete on public.teams for delete to authenticated
  using (app.can('team:manage', org_id));

-- (policies call security definer helpers so they never query team_members
-- under its own RLS, which would recurse)
alter table public.team_members enable row level security;
create policy tm_select on public.team_members for select to authenticated using (org_id in (select app.my_org_ids()));
create policy tm_insert on public.team_members for insert to authenticated
  with check (app.can('team:manage', org_id) or app.is_team_lead(team_id));
create policy tm_update on public.team_members for update to authenticated
  using (app.can('team:manage', org_id) or app.is_team_lead(team_id))
  with check (app.can('team:manage', org_id) or app.is_team_lead(team_id));
create policy tm_delete on public.team_members for delete to authenticated
  using (app.can('team:manage', org_id) or app.is_team_lead(team_id));

alter table public.projects enable row level security;
create policy projects_select on public.projects for select to authenticated
  using (app.project_visible(org_id, id, owner_id, created_by, visibility, team_id));
create policy projects_insert on public.projects for insert to authenticated
  with check (app.can('project:create', org_id) and created_by = (select auth.uid()));
create policy projects_update on public.projects for update to authenticated
  using (app.can_edit_project(id)) with check (org_id in (select app.my_org_ids()));
create policy projects_delete on public.projects for delete to authenticated using (app.can('project:manage', org_id));

alter table public.project_members enable row level security;
create policy pm_select on public.project_members for select to authenticated using (app.can_read_project(project_id));
create policy pm_write on public.project_members for all to authenticated
  using (app.can_edit_project(project_id)) with check (app.can_edit_project(project_id));

alter table public.sections enable row level security;
create policy sections_select on public.sections for select to authenticated using (app.can_read_project(project_id));
create policy sections_write on public.sections for all to authenticated
  using (app.can_edit_project(project_id)) with check (app.can_edit_project(project_id));

alter table public.tasks enable row level security;
create policy tasks_select on public.tasks for select to authenticated
  using (app.task_visible(org_id, id, project_id, parent_task_id, created_by));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (org_id in (select app.my_org_ids()) and app.module_enabled(org_id, 'tasks')
              and (created_by = (select auth.uid()))
              and app.can('task:create', org_id)
              and (project_id is null or app.can_read_project(project_id))
              and (parent_task_id is null or app.can_edit_task(parent_task_id)));
create policy tasks_update on public.tasks for update to authenticated
  using (app.can_edit_task(id)) with check (org_id in (select app.my_org_ids())
    and app.task_visible(org_id, id, project_id, parent_task_id, created_by));
create policy tasks_delete on public.tasks for delete to authenticated
  using (created_by = (select auth.uid()) or app.can('project:manage', org_id));

alter table public.task_assignees enable row level security;
create policy ta_select on public.task_assignees for select to authenticated using (app.can_read_task(task_id));
create policy ta_write on public.task_assignees for all to authenticated
  using (app.can_edit_task(task_id))
  with check (app.can_edit_task(task_id) and exists (select 1 from public.org_members m
              where m.org_id = task_assignees.org_id and m.user_id = task_assignees.user_id and m.status = 'active'));

alter table public.task_followers enable row level security;
create policy tf_select on public.task_followers for select to authenticated using (app.can_read_task(task_id));
create policy tf_write on public.task_followers for all to authenticated
  using (user_id = (select auth.uid()) or app.can_edit_task(task_id))
  with check (app.can_read_task(task_id) and (user_id = (select auth.uid()) or app.can_edit_task(task_id)));

alter table public.task_dependencies enable row level security;
create policy td_select on public.task_dependencies for select to authenticated using (app.can_read_task(task_id));
create policy td_write on public.task_dependencies for all to authenticated
  using (app.can_edit_task(task_id)) with check (app.can_edit_task(task_id) and app.can_read_task(depends_on_task_id));

alter table public.task_links enable row level security;
create policy tl_select on public.task_links for select to authenticated using (app.can_read_task(task_id));
create policy tl_write on public.task_links for all to authenticated
  using (app.can_edit_task(task_id)) with check (app.can_edit_task(task_id) and app.can_read_entity(entity_type, entity_id));

alter table public.task_templates enable row level security;
create policy tt_select on public.task_templates for select to authenticated using (org_id in (select app.my_org_ids()));
create policy tt_write on public.task_templates for all to authenticated
  using (app.can('project:create', org_id)) with check (app.can('project:create', org_id));

select app.add_standard_triggers(t) from unnest(array[
  'public.teams', 'public.projects', 'public.sections', 'public.tasks', 'public.task_templates'
]::regclass[]) t;
select app.add_audit('public.projects', 'project');
select app.add_audit('public.tasks', 'task');
select app.add_events('public.tasks', 'task');
select app.add_events('public.projects', 'project');

insert into app.entity_registry (entity_type, table_name, resource, module, campus_col, dept_col, owner_cols, title_col, number_col, url_template) values
  ('task', 'public.tasks', 'task', 'tasks', null, null, '{created_by}', 'title', null, '/tasks/t/{id}'),
  ('project', 'public.projects', 'project', 'tasks', null, null, '{owner_id,created_by}', 'name', null, '/tasks/projects/{id}'),
  ('team', 'public.teams', 'team', 'tasks', 'campus_id', null, '{created_by}', 'name', null, '/tasks/teams/{id}');
