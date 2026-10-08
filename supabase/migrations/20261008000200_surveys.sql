-- =============================================================================
-- Feedback & NPS ("surveys" module) and resolution feedback
--
--   surveys / survey_responses  NPS (0-10) or CSAT (1-5) surveys for members
--                               (answered in the app) and/or the public (a link
--                               or QR code for parents, students, visitors).
--   issues.resolved_by          who resolved an issue, so the reporter's rating
--                               of the fix is credited to that person.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- New module: add 'surveys' to every module check
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.contype = 'c' and c.connamespace = 'public'::regnamespace
      and pg_get_constraintdef(c.oid) like '%''tasks''::text%' and pg_get_constraintdef(c.oid) like '%''po''::text%'
      and pg_get_constraintdef(c.oid) not like '%''surveys''::text%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I %s', r.tbl, r.conname,
                   replace(r.def, '''po''::text', '''po''::text, ''surveys''::text'));
  end loop;
end $$;

alter table public.organisations alter column licensed_modules set default array['facility', 'expense', 'tasks', 'po', 'surveys'];

-- Every organisation has a row for every module (bootstrap only knows the first four).
create or replace function app.organisations_module_rows() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.org_modules (org_id, module, enabled)
  select new.id, m, m = any (new.licensed_modules)
  from unnest(array['facility', 'expense', 'tasks', 'po', 'surveys']) m
  on conflict do nothing;
  return null;
end $$;
create trigger organisations_module_rows after insert on public.organisations
  for each row execute function app.organisations_module_rows();

-- Existing organisations (not personal workspaces) get the new module.
update public.organisations set licensed_modules = licensed_modules || array['surveys']
where kind = 'organisation' and not ('surveys' = any (licensed_modules));
insert into public.org_modules (org_id, module, enabled)
select id, 'surveys', 'surveys' = any (licensed_modules) from public.organisations
on conflict do nothing;

create or replace function public.member_modules(p_org uuid, p_user uuid default null) returns text[]
language plpgsql stable security definer set search_path = public, app as $$
declare
  v_user uuid := coalesce(p_user, auth.uid());
begin
  if p_user is not null and p_user is distinct from auth.uid() and not app.is_service() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((select array_agg(m order by m) from unnest(array['facility', 'expense', 'tasks', 'po', 'surveys']) m
                   where app.module_allowed(p_org, v_user, m)), '{}');
end $$;

insert into public.permissions (key, module, description) values
  ('survey:read', 'surveys', 'See survey results, NPS and comments'),
  ('survey:manage', 'surveys', 'Create, edit, open and close surveys')
on conflict (key) do update set module = excluded.module, description = excluded.description;

-- -----------------------------------------------------------------------------
-- Surveys
-- -----------------------------------------------------------------------------
create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete set null,
  title text not null check (length(title) between 2 and 200),
  description text,
  kind text not null default 'nps' check (kind in ('nps', 'csat')),
  question text not null check (length(question) between 5 and 500),
  follow_up text check (length(follow_up) <= 500),
  audience text not null default 'members' check (audience in ('members', 'public', 'both')),
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  anonymous boolean not null default false,
  public_token text not null unique default replace(replace(rtrim(encode(extensions.gen_random_bytes(12), 'base64'), '='), '+', '-'), '/', '_'),
  closes_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.surveys (org_id, status) where deleted_at is null;
create trigger surveys_updated_at before update on public.surveys for each row execute function app.set_updated_at();
do $$ begin perform app.add_audit('public.surveys', 'survey'); end $$;

create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  survey_id uuid not null references public.surveys(id) on delete cascade,
  score smallint not null check (score between 0 and 10),
  comment text check (length(comment) <= 2000),
  segment text check (segment in ('staff', 'parent', 'student', 'alumni', 'visitor', 'other')),
  respondent_id uuid references public.profiles(id) on delete set null,
  respondent_name text check (length(respondent_name) <= 120),
  respondent_email text check (length(respondent_email) <= 200),
  campus_id uuid references public.campuses(id) on delete set null,
  source text not null default 'in_app' check (source in ('in_app', 'link')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.survey_responses (survey_id, created_at desc);
create unique index survey_responses_one_per_member on public.survey_responses (survey_id, respondent_id) where respondent_id is not null;
create trigger survey_responses_updated_at before update on public.survey_responses for each row execute function app.set_updated_at();

alter table public.surveys enable row level security;
alter table public.survey_responses enable row level security;

-- Members see surveys open to them; managers and readers see all of the org's surveys.
create policy surveys_select on public.surveys for select to authenticated using (
  deleted_at is null and app.module_enabled(org_id, 'surveys') and (
    app.can('survey:read', org_id) or app.can('survey:manage', org_id)
    or (app.is_member(org_id) and status = 'active' and audience in ('members', 'both'))
  ));
create policy surveys_write on public.surveys for all to authenticated
  using (app.can('survey:manage', org_id)) with check (app.can('survey:manage', org_id));

-- Responses: people see only their own rows. Results go through survey_results(),
-- which hides respondents of anonymous surveys even from managers.
create policy survey_responses_own on public.survey_responses for select to authenticated
  using (respondent_id = (select auth.uid()));

create or replace function app.survey_score_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
begin
  select kind into v_kind from public.surveys where id = new.survey_id;
  if v_kind = 'csat' and new.score not between 1 and 5 then
    raise exception 'score must be between 1 and 5' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger survey_responses_score before insert or update of score on public.survey_responses
  for each row execute function app.survey_score_check();

-- Open surveys this member hasn't answered yet (for the prompt on Home).
create or replace function public.my_pending_surveys(p_org uuid)
returns table (id uuid, title text, description text, kind text, question text, follow_up text, anonymous boolean)
language sql stable security definer set search_path = public, app as $$
  select s.id, s.title, s.description, s.kind, s.question, s.follow_up, s.anonymous
  from public.surveys s
  where s.org_id = p_org and app.is_member(p_org) and app.module_enabled(p_org, 'surveys')
    and s.deleted_at is null and s.status = 'active' and s.audience in ('members', 'both')
    and (s.closes_at is null or s.closes_at > now())
    and not exists (select 1 from public.survey_responses r where r.survey_id = s.id and r.respondent_id = auth.uid())
  order by s.created_at desc
$$;

-- A member answers (or changes their answer to) an open survey.
create or replace function public.survey_respond(p_survey uuid, p_score smallint, p_comment text default null)
returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  s public.surveys;
  v_id uuid;
  v_campus uuid;
begin
  select * into s from public.surveys where id = p_survey and deleted_at is null;
  if not found or not app.is_member(s.org_id) or not app.module_enabled(s.org_id, 'surveys') then
    raise exception 'survey not found' using errcode = 'P0002';
  end if;
  if s.status <> 'active' or s.audience not in ('members', 'both') or (s.closes_at is not null and s.closes_at <= now()) then
    raise exception 'this survey is not open' using errcode = 'P0001';
  end if;
  select campus_id into v_campus from public.org_members where org_id = s.org_id and user_id = auth.uid();
  insert into public.survey_responses (org_id, survey_id, score, comment, segment, respondent_id, campus_id, source)
  values (s.org_id, s.id, p_score, nullif(btrim(p_comment), ''), 'staff', auth.uid(), coalesce(s.campus_id, v_campus), 'in_app')
  on conflict (survey_id, respondent_id) where respondent_id is not null
  do update set score = excluded.score, comment = excluded.comment
  returning id into v_id;
  return v_id;
end $$;

-- Public survey (link / QR): what to show, and recording an answer. Service only:
-- the API adds captcha and rate limiting.
create or replace function public.public_survey(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  s public.surveys;
begin
  if not app.is_service() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from public.surveys where public_token = p_token and deleted_at is null;
  if not found or s.status <> 'active' or s.audience not in ('public', 'both')
     or (s.closes_at is not null and s.closes_at <= now()) or not app.org_module_enabled(s.org_id, 'surveys') or not app.org_active(s.org_id) then
    return null;
  end if;
  return jsonb_build_object(
    'id', s.id, 'title', s.title, 'description', s.description, 'kind', s.kind, 'question', s.question,
    'follow_up', s.follow_up, 'anonymous', s.anonymous,
    'organisation', (select jsonb_build_object('name', name, 'settings', settings) from public.organisations where id = s.org_id),
    'campus', (select name from public.campuses where id = s.campus_id)
  );
end $$;

create or replace function public.public_survey_respond(
  p_token text, p_score smallint, p_comment text default null, p_segment text default null,
  p_name text default null, p_email text default null
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  s public.surveys;
  v_id uuid;
begin
  if not app.is_service() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from public.surveys where public_token = p_token and deleted_at is null;
  if not found or s.status <> 'active' or s.audience not in ('public', 'both')
     or (s.closes_at is not null and s.closes_at <= now()) or not app.org_module_enabled(s.org_id, 'surveys') or not app.org_active(s.org_id) then
    raise exception 'this survey is not open' using errcode = 'P0001';
  end if;
  insert into public.survey_responses (org_id, survey_id, score, comment, segment, respondent_name, respondent_email, campus_id, source)
  values (s.org_id, s.id, p_score, nullif(btrim(p_comment), ''), coalesce(p_segment, 'other'),
          case when s.anonymous then null else nullif(btrim(p_name), '') end,
          case when s.anonymous then null else nullif(lower(btrim(p_email)), '') end,
          s.campus_id, 'link')
  returning id into v_id;
  return v_id;
end $$;

-- Results: NPS (promoters 9-10 minus detractors 0-6, as % of responses) or CSAT
-- (average and % satisfied, 4-5), distribution, weekly trend, segments, comments.
create or replace function public.survey_results(p_survey uuid, p_days int default null)
returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  s public.surveys;
  v_from timestamptz := case when p_days is null then '-infinity'::timestamptz else now() - make_interval(days => p_days) end;
  v_tz text;
begin
  select * into s from public.surveys where id = p_survey and deleted_at is null;
  if not found or not (app.is_service() or app.can('survey:read', s.org_id) or app.can('survey:manage', s.org_id))
     or not app.org_module_enabled(s.org_id, 'surveys') then
    raise exception 'survey not found' using errcode = 'P0002';
  end if;
  select timezone into v_tz from public.organisations where id = s.org_id;
  return (
    with r as (select * from public.survey_responses where survey_id = s.id and created_at >= v_from),
    g as (
      select r.*, case
        when s.kind = 'nps' and score >= 9 then 'promoter' when s.kind = 'nps' and score >= 7 then 'passive'
        when s.kind = 'nps' then 'detractor'
        when score >= 4 then 'promoter' when score = 3 then 'passive' else 'detractor' end as grp
      from r
    )
    select jsonb_build_object(
      'survey', to_jsonb(s) - 'public_token' || jsonb_build_object('public_token', case when app.is_service() or app.can('survey:manage', s.org_id) then s.public_token end),
      'responses', (select count(*) from g),
      'promoters', (select count(*) from g where grp = 'promoter'),
      'passives', (select count(*) from g where grp = 'passive'),
      'detractors', (select count(*) from g where grp = 'detractor'),
      'nps', (select round(100.0 * (count(*) filter (where grp = 'promoter') - count(*) filter (where grp = 'detractor')) / nullif(count(*), 0)) from g),
      'average', (select round(avg(score)::numeric, 1) from g),
      'satisfied_pct', (select round(100.0 * count(*) filter (where grp = 'promoter') / nullif(count(*), 0)) from g),
      'distribution', (select jsonb_agg(jsonb_build_object('score', n, 'count', (select count(*) from g where score = n)) order by n)
                       from generate_series(case when s.kind = 'nps' then 0 else 1 end, case when s.kind = 'nps' then 10 else 5 end) n),
      'trend', coalesce((select jsonb_agg(jsonb_build_object('t', wk, 'responses', n, 'nps', nps) order by wk) from (
                  select date_trunc('week', created_at at time zone v_tz) wk, count(*) n,
                    round(100.0 * (count(*) filter (where grp = 'promoter') - count(*) filter (where grp = 'detractor')) / nullif(count(*), 0)) nps
                  from g group by 1) x), '[]'),
      'segments', coalesce((select jsonb_agg(jsonb_build_object('segment', segment, 'responses', n, 'nps', nps, 'average', av) order by n desc) from (
                  select coalesce(segment, 'other') segment, count(*) n, round(avg(score)::numeric, 1) av,
                    round(100.0 * (count(*) filter (where grp = 'promoter') - count(*) filter (where grp = 'detractor')) / nullif(count(*), 0)) nps
                  from g group by 1) x), '[]'),
      'comments', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', g.id, 'score', g.score, 'group', g.grp, 'comment', g.comment, 'segment', g.segment, 'created_at', g.created_at,
                    'name', case when s.anonymous then null else coalesce(p.full_name, g.respondent_name) end,
                    'email', case when s.anonymous then null else coalesce(p.email, g.respondent_email) end) order by g.created_at desc)
                  from (select * from g where comment is not null order by created_at desc limit 200) g
                  left join public.profiles p on p.id = g.respondent_id), '[]')
    )
  );
end $$;

-- Survey list with headline numbers.
create or replace function public.survey_overview(p_org uuid)
returns table (id uuid, title text, kind text, audience text, status text, anonymous boolean, campus_id uuid,
               closes_at timestamptz, created_at timestamptz, responses bigint, score numeric, last_response_at timestamptz)
language sql stable security definer set search_path = public, app as $$
  select s.id, s.title, s.kind, s.audience, s.status, s.anonymous, s.campus_id, s.closes_at, s.created_at,
    st.n, st.score, st.last_at
  from public.surveys s
  cross join lateral (
    select count(*) n, max(created_at) last_at,
      case when s.kind = 'nps'
        then round(100.0 * (count(*) filter (where score >= 9) - count(*) filter (where score <= 6)) / nullif(count(*), 0))
        else round(avg(score)::numeric, 1) end as score
    from public.survey_responses r where r.survey_id = s.id
  ) st
  where s.org_id = p_org and s.deleted_at is null and app.org_module_enabled(p_org, 'surveys')
    and (app.is_service() or app.can('survey:read', p_org) or app.can('survey:manage', p_org))
  order by (s.status = 'active') desc, s.created_at desc
$$;

-- -----------------------------------------------------------------------------
-- Resolution feedback: credit the person who resolved an issue
-- -----------------------------------------------------------------------------
alter table public.issues add column resolved_by uuid references public.profiles(id) on delete set null;
create index on public.issues (org_id, resolved_by) where resolved_by is not null;
update public.issues set resolved_by = assignee_id where resolved_at is not null and resolved_by is null and assignee_id is not null;

create or replace function app.issues_set_resolver() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if new.status = 'resolved' and (tg_op = 'INSERT' or old.status is distinct from 'resolved') then
    new.resolved_by := coalesce(new.assignee_id, app.actor_id(), new.resolved_by);
  end if;
  return new;
end $$;
create trigger issues_set_resolver before insert or update of status on public.issues
  for each row execute function app.issues_set_resolver();

-- Ratings reporters gave to resolved issues, per resolver. Runs as the caller,
-- so it covers the issues they can see (org, campus or their own).
create or replace function public.resolution_feedback(p_org uuid, p_days int default 90, p_campus uuid default null)
returns jsonb
language plpgsql stable security invoker set search_path = public, app as $$
declare
  v_from timestamptz := now() - make_interval(days => greatest(7, least(coalesce(p_days, 90), 730)));
begin
  if not app.module_enabled(p_org, 'facility') then raise exception 'forbidden' using errcode = '42501'; end if;
  return (
    with i as (
      select * from public.issues
      where org_id = p_org and deleted_at is null and (p_campus is null or campus_id = p_campus) and resolved_at >= v_from
    )
    select jsonb_build_object(
      'resolved', (select count(*) from i),
      'rated', (select count(*) from i where rating is not null),
      'average', (select round(avg(rating)::numeric, 2) from i where rating is not null),
      'satisfied_pct', (select round(100.0 * count(*) filter (where rating >= 4) / nullif(count(*) filter (where rating is not null), 0)) from i),
      'reopened', (select count(*) from i where reopened_count > 0),
      'distribution', (select jsonb_agg(jsonb_build_object('score', n, 'count', (select count(*) from i where rating = n)) order by n)
                       from generate_series(1, 5) n),
      'resolvers', coalesce((select jsonb_agg(row_to_json(x)::jsonb order by x.rated desc, x.average desc nulls last) from (
                    select i.resolved_by as user_id, p.full_name as name, count(*) resolved, count(i.rating) rated,
                      round(avg(i.rating)::numeric, 2) average, count(*) filter (where i.reopened_count > 0) reopened
                    from i join public.profiles p on p.id = i.resolved_by
                    group by i.resolved_by, p.full_name) x), '[]'),
      'comments', coalesce((select jsonb_agg(jsonb_build_object(
                    'issue_id', i.id, 'number', i.number, 'title', i.title, 'rating', i.rating, 'feedback', i.feedback,
                    'at', i.feedback_at, 'resolver', p.full_name) order by i.feedback_at desc)
                  from (select * from i where rating is not null order by feedback_at desc nulls last limit 100) i
                  left join public.profiles p on p.id = i.resolved_by), '[]')
    )
  );
end $$;

-- Analytics: resolver ratings (me + per person) and NPS headline.
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
    'rating_avg', case when 'facility' = any (v_mods) then (select round(avg(rating)::numeric, 2) from public.issues
                       where org_id = p_org and deleted_at is null and resolved_by = v_uid and rating is not null and feedback_at >= v_from) end,
    'rating_count', case when 'facility' = any (v_mods) then (select count(*) from public.issues
                       where org_id = p_org and deleted_at is null and resolved_by = v_uid and rating is not null and feedback_at >= v_from) end,
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

  -- Feedback & NPS ---------------------------------------------------------
  if 'surveys' = any (v_mods) and (app.can('survey:read', p_org) or app.can('survey:manage', p_org)) then
    select r || jsonb_build_object('surveys', jsonb_build_object(
      'active', (select count(*) from public.surveys where org_id = p_org and deleted_at is null and status = 'active'),
      'responses', (select count(*) from public.survey_responses sr join public.surveys s on s.id = sr.survey_id
                    where s.org_id = p_org and s.deleted_at is null and sr.created_at >= v_from),
      'nps', (select round(100.0 * (count(*) filter (where sr.score >= 9) - count(*) filter (where sr.score <= 6)) / nullif(count(*), 0))
              from public.survey_responses sr join public.surveys s on s.id = sr.survey_id
              where s.org_id = p_org and s.deleted_at is null and s.kind = 'nps' and sr.created_at >= v_from)
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
        case when 'facility' = any (v_mods) then (select round(avg(rating)::numeric, 1) from public.issues
           where org_id = p_org and deleted_at is null and resolved_by = pr.id and rating is not null and feedback_at >= v_from) end as rating_avg,
        case when 'facility' = any (v_mods) then (select count(*) from public.issues
           where org_id = p_org and deleted_at is null and resolved_by = pr.id and rating is not null and feedback_at >= v_from) else 0 end as rating_count,
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

revoke execute on function public.my_pending_surveys(uuid) from public, anon;
revoke execute on function public.survey_respond(uuid, smallint, text) from public, anon;
revoke execute on function public.public_survey(text) from public, anon, authenticated;
revoke execute on function public.public_survey_respond(text, smallint, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.survey_results(uuid, int) from public, anon;
revoke execute on function public.survey_overview(uuid) from public, anon;
revoke execute on function public.resolution_feedback(uuid, int, uuid) from public, anon;
grant execute on function public.my_pending_surveys(uuid) to authenticated, service_role;
grant execute on function public.survey_respond(uuid, smallint, text) to authenticated, service_role;
grant execute on function public.public_survey(text) to service_role;
grant execute on function public.public_survey_respond(text, smallint, text, text, text, text) to service_role;
grant execute on function public.survey_results(uuid, int) to authenticated, service_role;
grant execute on function public.survey_overview(uuid) to authenticated, service_role;
grant execute on function public.resolution_feedback(uuid, int, uuid) to authenticated, service_role;
grant execute on function public.member_modules(uuid, uuid) to authenticated, service_role;
