-- Faster task / project visibility.
--
-- The SELECT policies called app.task_visible / app.can_read_task per row,
-- and each call ran ~9 lookups (module licence, project visibility,
-- permissions) whose answers are the same for every row of a query. Lists
-- slowed by ~1.7 ms per visible task (3-8 s for 50 tasks out of ~1,800).
--
-- The policies now test membership in sets computed once per query (hashed
-- sub-plans). The rules are exactly those of app.task_visible and
-- app.project_visible, which stay for single-row checks.

-- Organisations where the caller may use a module (= app.module_allowed for
-- auth.uid(), as one query).
create or replace function app.module_org_ids(p_module text) returns setof uuid
language sql stable security definer set search_path = public, app as $$
  select o.id from public.organisations o
  where o.status = 'active' and o.deleted_at is null and p_module = any (o.licensed_modules)
    and exists (select 1 from public.org_modules m where m.org_id = o.id and m.module = p_module and m.enabled)
    and not exists (
      select 1 from public.org_members om
      where om.org_id = o.id and om.user_id = auth.uid()
        and om.module_access is not null and not (p_module = any (om.module_access)))
$$;

-- Organisations where the caller holds a permission (org-wide, or anywhere).
create or replace function app.permission_org_ids(p_permission text, p_anywhere boolean default false) returns setof uuid
language sql stable security definer set search_path = public, app as $$
  select o from app.my_org_ids() o
  where case when p_anywhere then app.has_permission_anywhere(auth.uid(), p_permission, o)
             else app.has_permission(auth.uid(), p_permission, o) end
$$;

-- The caller's own links, as sets.
create or replace function app.my_member_project_ids() returns setof uuid
language sql stable security definer set search_path = public, app as $$
  select pm.project_id from public.project_members pm where pm.user_id = auth.uid()
$$;

create or replace function app.my_team_ids() returns setof uuid
language sql stable security definer set search_path = public, app as $$
  select tm.team_id from public.team_members tm where tm.user_id = auth.uid()
$$;

create or replace function app.my_assigned_task_ids() returns setof uuid
language sql stable security definer set search_path = public, app as $$
  select a.task_id from public.task_assignees a where a.user_id = auth.uid()
$$;

create or replace function app.my_followed_task_ids() returns setof uuid
language sql stable security definer set search_path = public, app as $$
  select f.task_id from public.task_followers f where f.user_id = auth.uid()
$$;

-- Projects the caller can read (same rules as app.project_visible).
create or replace function app.readable_project_ids() returns setof uuid
language sql stable security definer set search_path = public, app as $$
  select p.id from public.projects p
  where p.org_id in (select app.module_org_ids('tasks'))
    and (p.owner_id = auth.uid() or p.created_by = auth.uid()
      or p.id in (select app.my_member_project_ids())
      or (p.visibility = 'org' and p.org_id in (select app.permission_org_ids('task:read', true)))
      or (p.visibility = 'team' and p.team_id in (select app.my_team_ids()))
      or p.org_id in (select app.permission_org_ids('project:manage')))
$$;

-- Tasks the caller can read (same rules as app.task_visible).
create or replace function app.readable_task_ids() returns setof uuid
language sql stable security definer set search_path = public, app as $$
  select t.id from public.tasks t
  where t.org_id in (select app.module_org_ids('tasks'))
    and (t.created_by = auth.uid()
      or t.id in (select app.my_assigned_task_ids())
      or t.id in (select app.my_followed_task_ids())
      or t.project_id in (select app.readable_project_ids())
      or t.parent_task_id in (select app.my_assigned_task_ids())
      or t.org_id in (select app.permission_org_ids('project:manage')))
$$;

revoke execute on function app.module_org_ids(text), app.permission_org_ids(text, boolean),
  app.my_member_project_ids(), app.my_team_ids(), app.my_assigned_task_ids(), app.my_followed_task_ids(),
  app.readable_project_ids(), app.readable_task_ids() from public, anon;
grant execute on function app.module_org_ids(text), app.permission_org_ids(text, boolean),
  app.my_member_project_ids(), app.my_team_ids(), app.my_assigned_task_ids(), app.my_followed_task_ids(),
  app.readable_project_ids(), app.readable_task_ids() to authenticated, service_role;

-- tasks / projects test their own columns directly (so a row just inserted
-- passes, e.g. INSERT ... RETURNING) and the lookups through the sets.
alter policy projects_select on public.projects using (
  org_id in (select app.module_org_ids('tasks'))
  and (owner_id = (select auth.uid()) or created_by = (select auth.uid())
    or id in (select app.my_member_project_ids())
    or (visibility = 'org' and org_id in (select app.permission_org_ids('task:read', true)))
    or (visibility = 'team' and team_id in (select app.my_team_ids()))
    or org_id in (select app.permission_org_ids('project:manage'))));

alter policy tasks_select on public.tasks using (
  org_id in (select app.module_org_ids('tasks'))
  and (created_by = (select auth.uid())
    or id in (select app.my_assigned_task_ids())
    or id in (select app.my_followed_task_ids())
    or project_id in (select app.readable_project_ids())
    or parent_task_id in (select app.my_assigned_task_ids())
    or org_id in (select app.permission_org_ids('project:manage'))));

alter policy pm_select on public.project_members using (project_id in (select app.readable_project_ids()));
alter policy sections_select on public.sections using (project_id in (select app.readable_project_ids()));
alter policy ta_select on public.task_assignees using (task_id in (select app.readable_task_ids()));
alter policy tf_select on public.task_followers using (task_id in (select app.readable_task_ids()));
alter policy td_select on public.task_dependencies using (task_id in (select app.readable_task_ids()));
alter policy tl_select on public.task_links using (task_id in (select app.readable_task_ids()));

-- The write policies were FOR ALL, so their (expensive, per-row) USING
-- clauses also ran on every SELECT. Split them so reads use only the
-- fast policies above. The write rules are unchanged.
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

-- Subtask counts in task lists look up children without the deleted_at
-- filter, so the partial index can't serve them.
create index if not exists tasks_parent_task_id_all_idx on public.tasks (parent_task_id);
