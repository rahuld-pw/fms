-- Tasks overview: progress across the tasks the caller can see. SECURITY
-- INVOKER, so row-level security decides the scope (own tasks, projects one
-- belongs to, or everything for project managers). Subtasks are left out of
-- the counts, like the organisation analytics.
create or replace function public.task_dashboard(p_org uuid, p_days int default 30)
returns jsonb
language plpgsql stable security invoker set search_path = public, app, extensions as $$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 7), 365);
  v_tz text := coalesce((select timezone from public.organisations where id = p_org), 'Asia/Kolkata');
  v_from timestamptz := now() - make_interval(days => v_days);
  v_bucket text := case when v_days <= 31 then 'day' when v_days <= 120 then 'week' else 'month' end;
  v_today date := (now() at time zone v_tz)::date;
  r jsonb;
begin
  with t as (
    select * from public.tasks
    where org_id = p_org and deleted_at is null and parent_task_id is null
  ),
  open_t as (select * from t where status not in ('done', 'cancelled'))
  select jsonb_build_object(
    'days', v_days,
    'bucket', v_bucket,
    'open', (select count(*) from open_t),
    'overdue', (select count(*) from open_t where due_date < v_today),
    'due_week', (select count(*) from open_t where due_date between v_today and v_today + 7),
    'blocked', (select count(*) from open_t where status = 'blocked'),
    'created', (select count(*) from t where created_at >= v_from),
    'completed', (select count(*) from t where status = 'done' and completed_at >= v_from),
    'on_time_pct', (select round(100.0 * count(*) filter (where due_date is null or (completed_at at time zone v_tz)::date <= due_date) / nullif(count(*), 0))
                    from t where status = 'done' and completed_at >= v_from),
    'avg_days_to_complete', (select round(avg(extract(epoch from completed_at - created_at) / 86400)::numeric, 1)
                             from t where status = 'done' and completed_at >= v_from),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from t group by status) x),
    'open_by_priority', (select coalesce(jsonb_object_agg(priority, n), '{}') from (select priority, count(*) n from open_t group by priority) x),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('t', b, 'created', cr, 'completed', co) order by b), '[]') from (
                select b,
                  (select count(*) from t where date_trunc(v_bucket, t.created_at at time zone v_tz) = b) cr,
                  (select count(*) from t where t.status = 'done' and date_trunc(v_bucket, t.completed_at at time zone v_tz) = b) co
                from generate_series(date_trunc(v_bucket, v_from at time zone v_tz), date_trunc(v_bucket, now() at time zone v_tz),
                                     ('1 ' || v_bucket)::interval) b) x),
    'projects', (select coalesce(jsonb_agg(row_to_json(p)::jsonb order by p.open desc, p.name), '[]') from (
                  select pr.id, pr.name, pr.color,
                    count(*) filter (where t.status not in ('done', 'cancelled')) as open,
                    count(*) filter (where t.status not in ('done', 'cancelled') and t.due_date < v_today) as overdue,
                    count(*) filter (where t.status = 'done') as done,
                    count(*) filter (where t.status <> 'cancelled') as total
                  from t join public.projects pr on pr.id = t.project_id and pr.deleted_at is null
                  group by pr.id, pr.name, pr.color
                  order by count(*) filter (where t.status not in ('done', 'cancelled')) desc, pr.name
                  limit 8) p),
    'people', (select coalesce(jsonb_agg(row_to_json(w)::jsonb order by w.open desc, w.name), '[]') from (
                select pf.id as user_id, pf.full_name as name,
                  count(*) as open,
                  count(*) filter (where o.due_date < v_today) as overdue
                from open_t o join public.task_assignees a on a.task_id = o.id
                join public.profiles pf on pf.id = a.user_id
                group by pf.id, pf.full_name
                order by count(*) desc, pf.full_name
                limit 10) w)
  ) into r;
  return r;
end $$;

revoke execute on function public.task_dashboard(uuid, int) from public, anon;
grant execute on function public.task_dashboard(uuid, int) to authenticated, service_role;
