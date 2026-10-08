-- =============================================================================
-- Analytics
--
--   org_analytics        runs as the caller (security invoker), so row-level
--                        security decides what each person sees: an org admin
--                        sees the whole organisation, a campus or department
--                        manager their campus/department, staff their own work.
--   platform_analytics   platform super admins: growth, usage and feedback
--                        across tenants (counts only, no tenant content).
-- =============================================================================

-- What the caller's analytics cover, for labelling (who sees what is still RLS).
create or replace function public.analytics_scope(p_org uuid)
returns jsonb
language sql stable security definer set search_path = public, app as $$
  with a as (
    select a.scope_type, a.campus_id, a.department_id, r.key as role_key, r.is_superuser
    from public.user_role_assignments a
    join public.roles r on r.id = a.role_id
    join public.org_members m on m.org_id = a.org_id and m.user_id = a.user_id and m.status = 'active'
    where a.org_id = p_org and a.user_id = auth.uid() and (a.expires_at is null or a.expires_at > now())
  )
  select jsonb_build_object(
    'level', case
      when exists (select 1 from a where scope_type = 'org' and (is_superuser or role_key not in ('staff', 'technician'))) then 'organisation'
      when exists (select 1 from a where scope_type = 'campus') then 'campus'
      when exists (select 1 from a where scope_type = 'department') then 'department'
      else 'personal' end,
    'campuses', coalesce((select jsonb_agg(distinct c.name) from a join public.campuses c on c.id = a.campus_id where a.scope_type = 'campus'), '[]'),
    'departments', coalesce((select jsonb_agg(distinct d.name) from a join public.departments d on d.id = a.department_id where a.scope_type = 'department'), '[]'),
    'roles', coalesce((select jsonb_agg(distinct r.name) from public.user_role_assignments ura join public.roles r on r.id = ura.role_id
                       where ura.org_id = p_org and ura.user_id = auth.uid()), '[]'),
    'direct_reports', (select count(*) from public.org_members where org_id = p_org and manager_id = auth.uid() and status = 'active')
  )
$$;

create or replace function public.org_analytics(p_org uuid, p_days int default 90, p_campus uuid default null)
returns jsonb
language plpgsql stable security invoker set search_path = public, app as $$
declare
  v_days int := greatest(7, least(coalesce(p_days, 90), 730));
  v_from timestamptz := date_trunc('day', now()) - make_interval(days => v_days);
  v_bucket text := case when v_days <= 31 then 'day' when v_days <= 180 then 'week' else 'month' end;
  v_tz text;
  v_mods text[];
  v_uid uuid := auth.uid();
  v_reports uuid[];
  r jsonb;
begin
  if not app.is_member(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  select timezone into v_tz from public.organisations where id = p_org;
  v_mods := public.member_modules(p_org);
  select coalesce(array_agg(user_id), '{}') into v_reports from public.org_members
  where org_id = p_org and manager_id = v_uid and status = 'active';

  r := jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', now(), 'days', v_days, 'bucket', v_bucket),
    'scope', public.analytics_scope(p_org),
    'modules', to_jsonb(v_mods)
  );

  -- Me ---------------------------------------------------------------------
  r := r || jsonb_build_object('me', jsonb_build_object(
    'tasks_completed', (select count(*) from public.tasks t join public.task_assignees ta on ta.task_id = t.id and ta.user_id = v_uid
                        where t.org_id = p_org and t.deleted_at is null and t.completed_at >= v_from),
    'tasks_on_time_pct', (select round(100.0 * count(*) filter (where t.due_date is null or t.completed_at::date <= t.due_date) / nullif(count(*), 0))
                          from public.tasks t join public.task_assignees ta on ta.task_id = t.id and ta.user_id = v_uid
                          where t.org_id = p_org and t.deleted_at is null and t.completed_at >= v_from),
    'tasks_open', (select count(*) from public.tasks t join public.task_assignees ta on ta.task_id = t.id and ta.user_id = v_uid
                   where t.org_id = p_org and t.deleted_at is null and t.status not in ('done', 'cancelled')),
    'tasks_overdue', (select count(*) from public.tasks t join public.task_assignees ta on ta.task_id = t.id and ta.user_id = v_uid
                      where t.org_id = p_org and t.deleted_at is null and t.status not in ('done', 'cancelled') and t.due_date < current_date),
    'issues_reported', case when 'facility' = any (v_mods) then (select count(*) from public.issues
                       where org_id = p_org and deleted_at is null and reporter_id = v_uid and created_at >= v_from) end,
    'issues_resolved', case when 'facility' = any (v_mods) then (select count(*) from public.issues
                       where org_id = p_org and deleted_at is null and assignee_id = v_uid and resolved_at >= v_from) end,
    'work_orders_completed', case when 'facility' = any (v_mods) then (select count(*) from public.work_orders
                       where org_id = p_org and deleted_at is null and assignee_id = v_uid and completed_at >= v_from) end,
    'claims_amount', case when 'expense' = any (v_mods) then (select coalesce(sum(total_amount), 0) from public.expense_claims
                       where org_id = p_org and deleted_at is null and claimant_id = v_uid and submitted_at >= v_from
                       and status not in ('draft', 'cancelled', 'rejected')) end,
    'approvals_decided', (select count(*) from public.approval_actions aa
                          where aa.org_id = p_org and aa.actor_id = v_uid and aa.created_at >= v_from
                          and aa.action in ('approve', 'reject'))
  ));

  -- Facilities -------------------------------------------------------------
  if 'facility' = any (v_mods) then
    with i as (
      select * from public.issues where org_id = p_org and deleted_at is null and (p_campus is null or campus_id = p_campus)
    )
    select r || jsonb_build_object('facility', jsonb_build_object(
      'issues_opened', (select count(*) from i where created_at >= v_from),
      'issues_resolved', (select count(*) from i where resolved_at >= v_from),
      'issues_open', (select count(*) from i where status not in ('resolved', 'closed', 'cancelled')),
      'issues_overdue', (select count(*) from i where status not in ('resolved', 'closed', 'cancelled') and resolution_due_at < now()),
      'sla_met_pct', (select round(100.0 * count(*) filter (where resolution_due_at is null or resolved_at <= resolution_due_at) / nullif(count(*), 0))
                      from i where resolved_at >= v_from),
      'avg_resolution_hours', (select round((extract(epoch from avg(resolved_at - created_at)) / 3600)::numeric, 1) from i where resolved_at >= v_from),
      'avg_rating', (select round(avg(rating)::numeric, 1) from i where rating is not null and feedback_at >= v_from),
      'open_by_priority', (select coalesce(jsonb_object_agg(priority, n), '{}') from (
                            select priority, count(*) n from i where status not in ('resolved', 'closed', 'cancelled') group by priority) x),
      'by_category', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', n) order by n desc), '[]') from (
                       select coalesce(c.name, 'Uncategorised') label, count(*) n from i left join public.issue_categories c on c.id = i.category_id
                       where i.created_at >= v_from group by 1 order by 2 desc limit 8) x),
      'work_orders_completed', (select count(*) from public.work_orders where org_id = p_org and deleted_at is null
                                and (p_campus is null or campus_id = p_campus) and completed_at >= v_from),
      'work_orders_open', (select count(*) from public.work_orders where org_id = p_org and deleted_at is null
                           and (p_campus is null or campus_id = p_campus) and status not in ('completed', 'verified', 'cancelled')),
      'maintenance_cost', (select coalesce(sum(coalesce(labour_cost, 0) + coalesce(material_cost, 0)), 0) from public.work_orders
                           where org_id = p_org and deleted_at is null and (p_campus is null or campus_id = p_campus) and completed_at >= v_from),
      'series', (select coalesce(jsonb_agg(jsonb_build_object('t', b, 'opened', o, 'resolved', s) order by b), '[]') from (
                  select b,
                    (select count(*) from i where date_trunc(v_bucket, i.created_at at time zone v_tz) = b) o,
                    (select count(*) from i where date_trunc(v_bucket, i.resolved_at at time zone v_tz) = b) s
                  from generate_series(date_trunc(v_bucket, v_from at time zone v_tz), date_trunc(v_bucket, now() at time zone v_tz),
                                       ('1 ' || v_bucket)::interval) b) x)
    )) into r;
  end if;

  -- Expenses ---------------------------------------------------------------
  if 'expense' = any (v_mods) then
    with c as (
      select * from public.expense_claims where org_id = p_org and deleted_at is null and (p_campus is null or campus_id = p_campus)
    )
    select r || jsonb_build_object('expense', jsonb_build_object(
      'claims_submitted', (select count(*) from c where submitted_at >= v_from),
      'approved_amount', (select coalesce(sum(total_amount), 0) from c where approved_at >= v_from and status in ('approved', 'paid')),
      'paid_amount', (select coalesce(sum(total_amount), 0) from c where paid_at >= v_from),
      'pending_count', (select count(*) from c where status = 'pending_approval'),
      'pending_amount', (select coalesce(sum(total_amount), 0) from c where status = 'pending_approval'),
      'avg_approval_hours', (select round((extract(epoch from avg(approved_at - submitted_at)) / 3600)::numeric, 1) from c where approved_at >= v_from),
      'by_category', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', amt) order by amt desc), '[]') from (
                       select coalesce(ec.name, 'Uncategorised') label, sum(it.amount) amt
                       from c join public.expense_items it on it.claim_id = c.id
                       left join public.expense_categories ec on ec.id = it.category_id
                       where c.approved_at >= v_from and c.status in ('approved', 'paid') group by 1 order by 2 desc limit 8) x),
      'series', (select coalesce(jsonb_agg(jsonb_build_object('t', b, 'approved', a) order by b), '[]') from (
                  select b, (select coalesce(sum(total_amount), 0) from c where c.status in ('approved', 'paid')
                             and date_trunc(v_bucket, c.approved_at at time zone v_tz) = b) a
                  from generate_series(date_trunc(v_bucket, v_from at time zone v_tz), date_trunc(v_bucket, now() at time zone v_tz),
                                       ('1 ' || v_bucket)::interval) b) x)
    )) into r;
  end if;

  -- Purchasing -------------------------------------------------------------
  if 'po' = any (v_mods) then
    with p as (
      select * from public.purchase_orders where org_id = p_org and deleted_at is null and (p_campus is null or campus_id = p_campus)
    )
    select r || jsonb_build_object('po', jsonb_build_object(
      'po_count', (select count(*) from p where approved_at >= v_from),
      'po_value', (select coalesce(sum(total), 0) from p where approved_at >= v_from and status not in ('cancelled', 'rejected')),
      'pending_count', (select count(*) from p where status = 'pending_approval'),
      'avg_approval_hours', (select round((extract(epoch from avg(approved_at - created_at)) / 3600)::numeric, 1) from p where approved_at >= v_from),
      'by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from p where created_at >= v_from group by status) x),
      'top_vendors', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', amt) order by amt desc), '[]') from (
                       select v.name label, sum(p.total) amt from p join public.vendors v on v.id = p.vendor_id
                       where p.approved_at >= v_from and p.status not in ('cancelled', 'rejected') group by 1 order by 2 desc limit 8) x),
      'series', (select coalesce(jsonb_agg(jsonb_build_object('t', b, 'value', a) order by b), '[]') from (
                  select b, (select coalesce(sum(total), 0) from p where p.status not in ('cancelled', 'rejected')
                             and date_trunc(v_bucket, p.approved_at at time zone v_tz) = b) a
                  from generate_series(date_trunc(v_bucket, v_from at time zone v_tz), date_trunc(v_bucket, now() at time zone v_tz),
                                       ('1 ' || v_bucket)::interval) b) x)
    )) into r;
  end if;

  -- Tasks ------------------------------------------------------------------
  if 'tasks' = any (v_mods) then
    with t as (select * from public.tasks where org_id = p_org and deleted_at is null and parent_task_id is null)
    select r || jsonb_build_object('tasks', jsonb_build_object(
      'created', (select count(*) from t where created_at >= v_from),
      'completed', (select count(*) from t where completed_at >= v_from),
      'open', (select count(*) from t where status not in ('done', 'cancelled')),
      'overdue', (select count(*) from t where status not in ('done', 'cancelled') and due_date < current_date),
      'on_time_pct', (select round(100.0 * count(*) filter (where due_date is null or completed_at::date <= due_date) / nullif(count(*), 0))
                      from t where completed_at >= v_from),
      'by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from t group by status) x),
      'series', (select coalesce(jsonb_agg(jsonb_build_object('t', b, 'created', cr, 'completed', co) order by b), '[]') from (
                  select b,
                    (select count(*) from t where date_trunc(v_bucket, t.created_at at time zone v_tz) = b) cr,
                    (select count(*) from t where date_trunc(v_bucket, t.completed_at at time zone v_tz) = b) co
                  from generate_series(date_trunc(v_bucket, v_from at time zone v_tz), date_trunc(v_bucket, now() at time zone v_tz),
                                       ('1 ' || v_bucket)::interval) b) x)
    )) into r;
  end if;

  -- People: workload per person (managers: their direct reports; admins:
  -- everyone they can see work for). Staff only ever see themselves.
  select r || jsonb_build_object('people', coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.open_items desc, x.name)
    from (
      select pr.id as user_id, pr.full_name as name,
        (select count(*) from public.tasks t join public.task_assignees ta on ta.task_id = t.id
           where ta.user_id = pr.id and t.org_id = p_org and t.deleted_at is null and t.status not in ('done', 'cancelled'))
        + case when 'facility' = any (v_mods) then
            (select count(*) from public.issues where org_id = p_org and deleted_at is null and assignee_id = pr.id
               and status not in ('resolved', 'closed', 'cancelled'))
          + (select count(*) from public.work_orders where org_id = p_org and deleted_at is null and assignee_id = pr.id
               and status not in ('completed', 'verified', 'cancelled')) else 0 end as open_items,
        (select count(*) from public.tasks t join public.task_assignees ta on ta.task_id = t.id
           where ta.user_id = pr.id and t.org_id = p_org and t.deleted_at is null and t.status not in ('done', 'cancelled')
           and t.due_date < current_date) as overdue_tasks,
        (select count(*) from public.tasks t join public.task_assignees ta on ta.task_id = t.id
           where ta.user_id = pr.id and t.org_id = p_org and t.deleted_at is null and t.completed_at >= v_from)
        + case when 'facility' = any (v_mods) then
            (select count(*) from public.issues where org_id = p_org and deleted_at is null and assignee_id = pr.id and resolved_at >= v_from)
          + (select count(*) from public.work_orders where org_id = p_org and deleted_at is null and assignee_id = pr.id and completed_at >= v_from)
          else 0 end as completed,
        pr.id = any (v_reports) as direct_report
      from public.profiles pr
      join public.org_members m on m.user_id = pr.id and m.org_id = p_org and m.status = 'active'
      where pr.id = any (v_reports)
         or (public.analytics_scope(p_org) ->> 'level') <> 'personal'
         or pr.id = v_uid
    ) x
    where x.open_items > 0 or x.completed > 0 or x.direct_report
    limit 25), '[]'::jsonb)) into r;

  return r;
end $$;

-- -----------------------------------------------------------------------------
-- Platform (super admin)
-- -----------------------------------------------------------------------------
create or replace function public.platform_analytics(p_days int default 90)
returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  v_days int := greatest(7, least(coalesce(p_days, 90), 730));
  v_from timestamptz := date_trunc('day', now()) - make_interval(days => v_days);
  v_bucket text := case when v_days <= 31 then 'day' when v_days <= 180 then 'week' else 'month' end;
begin
  perform app.require_platform_admin();
  return jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', now(), 'days', v_days, 'bucket', v_bucket),
    'organisations', (select count(*) from public.organisations where kind = 'organisation' and deleted_at is null),
    'organisations_suspended', (select count(*) from public.organisations where kind = 'organisation' and status = 'suspended' and deleted_at is null),
    'workspaces', (select count(*) from public.organisations where kind = 'personal' and deleted_at is null),
    'users', (select count(*) from public.profiles),
    'new_users', (select count(*) from public.profiles where created_at >= v_from),
    'active_7d', (select count(*) from auth.users where last_sign_in_at >= now() - interval '7 days'),
    'active_30d', (select count(*) from auth.users where last_sign_in_at >= now() - interval '30 days'),
    'pending_invites', (select count(*) from public.org_invitations where accepted_at is null and revoked_at is null and expires_at > now()),
    'licences', (select coalesce(jsonb_object_agg(m, n), '{}') from (
                  select m, count(*) n from public.organisations o, unnest(o.licensed_modules) m
                  where o.kind = 'organisation' and o.deleted_at is null group by m) x),
    'feedback', (select coalesce(jsonb_object_agg(kind || ':' || status, n), '{}') from (
                  select kind, status, count(*) n from public.feedback group by kind, status) x),
    'feedback_open', (select count(*) from public.feedback where status in ('new', 'triaged', 'planned', 'in_progress')),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('t', b, 'signups', s, 'organisations', o, 'workspaces', w) order by b), '[]') from (
                select b,
                  (select count(*) from public.profiles u where date_trunc(v_bucket, u.created_at) = b) s,
                  (select count(*) from public.organisations x where x.kind = 'organisation' and date_trunc(v_bucket, x.created_at) = b) o,
                  (select count(*) from public.organisations x where x.kind = 'personal' and date_trunc(v_bucket, x.created_at) = b) w
                from generate_series(date_trunc(v_bucket, v_from), date_trunc(v_bucket, now()), ('1 ' || v_bucket)::interval) b) x),
    'top_organisations', (select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.activity desc), '[]') from (
                  select o.id, o.name, o.kind,
                    (select count(*) from public.org_members m where m.org_id = o.id and m.status = 'active') as members,
                    (select count(*) from public.activity_log a where a.org_id = o.id and a.created_at >= v_from) as activity
                  from public.organisations o where o.deleted_at is null
                  order by activity desc limit 10) x)
  );
end $$;

revoke execute on function public.analytics_scope(uuid) from public, anon;
revoke execute on function public.org_analytics(uuid, int, uuid) from public, anon;
revoke execute on function public.platform_analytics(int) from public, anon;
grant execute on function public.analytics_scope(uuid) to authenticated, service_role;
grant execute on function public.org_analytics(uuid, int, uuid) to authenticated, service_role;
grant execute on function public.platform_analytics(int) to authenticated, service_role;
