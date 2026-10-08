-- Confidential ("anonymous") issue reporting by signed-in members.
--
-- A member can report an issue anonymously: colleagues, assignees, vendors
-- and anyone else who can see the issue see "Anonymous"; only organisation
-- admins (org:manage: the Owner and Administrator roles) can see who it was.
-- The reporter keeps their usual rights on it (follow it, comment, close,
-- reopen, rate the resolution) without their name showing.
--
-- * issues.reporter_id / created_by / updated_by stay NULL on these issues.
-- * issues.reporter_token is a keyed hash (HMAC) of issue id + reporter. It
--   lets the database recognise the reporter without revealing them; the key
--   is server-only, so nobody can work out whose token it is.
-- * issue_reporter_identities holds the reporter, readable only by the
--   reporter themself and organisation admins.
-- * Activity entries, comments and attachments the reporter adds to their
--   anonymous issue are stored without their name ("Anonymous reporter").
-- Public QR reports marked anonymous stay fully anonymous (no one stored).

create table app.confidential_keys (
  id boolean primary key default true check (id),
  secret bytea not null default extensions.gen_random_bytes(32)
);
insert into app.confidential_keys default values on conflict do nothing;
revoke all on app.confidential_keys from public, anon, authenticated;

-- Only callable by other database functions (not exposed to users).
create or replace function app.reporter_token(p_issue uuid, p_user uuid) returns text
language sql stable security definer set search_path = public, app, extensions as $$
  select case when p_issue is null or p_user is null then null
    else encode(extensions.hmac(convert_to(p_issue::text || ':' || p_user::text, 'UTF8'), (select secret from app.confidential_keys), 'sha256'), 'hex') end
$$;
revoke execute on function app.reporter_token(uuid, uuid) from public, anon, authenticated;

alter table public.issues add column reporter_token text;

create table public.issue_reporter_identities (
  issue_id uuid primary key references public.issues(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index on public.issue_reporter_identities (user_id);
alter table public.issue_reporter_identities enable row level security;
create policy iri_select on public.issue_reporter_identities for select to authenticated
  using (user_id = (select auth.uid()) or org_id in (select app.permission_org_ids('org:manage')));
-- written only by the trigger below

-- Is the caller the anonymous reporter of this issue?
create or replace function app.is_my_anonymous_issue(p_issue uuid) returns boolean
language sql stable security definer set search_path = public, app, extensions as $$
  select exists (select 1 from public.issues i
    where i.id = p_issue and i.is_anonymous and i.reporter_token is not null
      and i.reporter_token = app.reporter_token(i.id, auth.uid()))
$$;

-- The caller's token for an issue (for policies on the issue row itself).
create or replace function app.my_reporter_token(p_issue uuid) returns text
language sql stable security definer set search_path = public, app, extensions as $$
  select app.reporter_token(p_issue, auth.uid())
$$;

-- PostgREST computed field: issues?select=*,reported_by_me
create or replace function public.reported_by_me(i public.issues) returns boolean
language sql stable security definer set search_path = public, app, extensions as $$
  select coalesce(i.reporter_id = auth.uid(), false)
    or coalesce(i.is_anonymous and i.reporter_token = app.reporter_token(i.id, auth.uid()), false)
$$;

revoke execute on function app.is_my_anonymous_issue(uuid), app.my_reporter_token(uuid), public.reported_by_me(public.issues) from public, anon;
grant execute on function app.is_my_anonymous_issue(uuid), app.my_reporter_token(uuid), public.reported_by_me(public.issues) to authenticated, service_role;

-- Runs first among the BEFORE INSERT triggers: remembers who reported.
create or replace function app.issues_confidential_capture() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
declare
  v_reporter uuid;
begin
  if tg_op = 'INSERT' then
    v_reporter := coalesce(new.reporter_id, app.actor_id());
    if new.is_anonymous and v_reporter is not null then
      new.reporter_token := app.reporter_token(new.id, v_reporter);
      perform set_config('app.anonymous_reporter', new.id::text || '=' || v_reporter::text, true);
    else
      new.reporter_token := null;
    end if;
  end if;
  return new;
end $$;
create trigger issues_a_confidential_capture before insert on public.issues
  for each row execute function app.issues_confidential_capture();

-- Runs last among the BEFORE triggers (after the actor stamps): no names.
create or replace function app.issues_confidential_mask() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if tg_op = 'UPDATE' then
    if new.is_anonymous is distinct from old.is_anonymous then
      raise exception 'an issue can''t switch between anonymous and named' using errcode = '23514';
    end if;
    new.reporter_token := old.reporter_token;
  end if;
  if new.is_anonymous then
    new.reporter_id := null;
    if tg_op = 'INSERT' then
      new.created_by := null;
      new.updated_by := null;
    else
      new.created_by := old.created_by;
      if new.updated_by is not null and new.reporter_token = app.reporter_token(new.id, new.updated_by) then
        new.updated_by := null;
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger zz_issues_confidential_mask before insert or update on public.issues
  for each row execute function app.issues_confidential_mask();

create or replace function app.issues_confidential_record() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
declare
  v text := current_setting('app.anonymous_reporter', true);
begin
  if new.is_anonymous and new.reporter_token is not null and v like new.id::text || '=%' then
    insert into public.issue_reporter_identities (issue_id, org_id, user_id)
    values (new.id, new.org_id, split_part(v, '=', 2)::uuid)
    on conflict (issue_id) do nothing;
  end if;
  return null;
end $$;
create trigger issues_confidential_record after insert on public.issues
  for each row execute function app.issues_confidential_record();

-- Reporter's own access to the issue row.
create policy issues_anonymous_reporter_select on public.issues for select to authenticated
  using (case when is_anonymous then reporter_token = app.my_reporter_token(id) else false end);
create policy issues_anonymous_reporter_update on public.issues for update to authenticated
  using (case when is_anonymous then reporter_token = app.my_reporter_token(id) else false end)
  with check (case when is_anonymous then reporter_token = app.my_reporter_token(id) else false end);

-- Members may report anonymously as well as under their name.
alter policy issues_report on public.issues
  with check (app.can('issue:report', org_id, campus_id) and (
    (reporter_id = (select auth.uid()) and not is_anonymous)
    or (is_anonymous and reporter_id is null and reporter_token = app.my_reporter_token(id))));

-- Activity, comments and attachments by the anonymous reporter: no name.
create or replace function app.mask_anonymous_reporter() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
declare
  v_actor uuid;
  v_issue uuid;
  v_pending text := current_setting('app.anonymous_reporter', true);
begin
  if new.entity_type <> 'issue' then return new; end if;
  v_issue := new.entity_id;
  v_actor := (to_jsonb(new) ->> case tg_table_name
    when 'activity_log' then 'actor_id' when 'comments' then 'author_id' else 'uploaded_by' end)::uuid;
  if v_actor is null then return new; end if;
  if v_pending = v_issue::text || '=' || v_actor::text
     or exists (select 1 from public.issues i where i.id = v_issue and i.is_anonymous and i.reporter_token is not null
                and i.reporter_token = app.reporter_token(i.id, v_actor)) then
    if tg_table_name = 'activity_log' then
      new.actor_id := null;
      new.actor_type := 'anonymous';
    elsif tg_table_name = 'comments' then
      new.author_id := null;
      new.author_label := 'Anonymous reporter';
    else
      new.uploaded_by := null;
    end if;
  end if;
  return new;
end $$;
create trigger zz_mask_anonymous_reporter before insert on public.activity_log
  for each row execute function app.mask_anonymous_reporter();
create trigger zz_mask_anonymous_reporter before insert on public.comments
  for each row execute function app.mask_anonymous_reporter();
create trigger zz_mask_anonymous_reporter before insert on public.attachments
  for each row execute function app.mask_anonymous_reporter();

create policy comments_anonymous_reporter_insert on public.comments for insert to authenticated
  with check (entity_type = 'issue' and author_id is null and app.is_my_anonymous_issue(entity_id));
create policy attachments_anonymous_reporter_insert on public.attachments for insert to authenticated
  with check (entity_type = 'issue' and uploaded_by is null and app.is_my_anonymous_issue(entity_id));

-- Reporter-side rules (close / reopen / rate), read access to comments and
-- status notifications also recognise the anonymous reporter.
CREATE OR REPLACE FUNCTION app.issues_before_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare
  v_actor uuid := app.actor_id();
  v_manager boolean;
  v_allowed text[];
  v_transitions jsonb := '{
    "open": ["acknowledged", "assigned", "in_progress", "on_hold", "resolved", "cancelled"],
    "acknowledged": ["assigned", "in_progress", "on_hold", "resolved", "cancelled"],
    "assigned": ["acknowledged", "in_progress", "on_hold", "resolved", "cancelled", "open"],
    "in_progress": ["on_hold", "resolved", "assigned", "cancelled"],
    "on_hold": ["in_progress", "assigned", "resolved", "cancelled"],
    "resolved": ["closed", "reopened"],
    "closed": ["reopened"],
    "reopened": ["acknowledged", "assigned", "in_progress", "on_hold", "resolved", "cancelled"],
    "cancelled": ["reopened"]
  }'::jsonb;
begin
  if new.status <> old.status and not (v_transitions -> old.status) ? new.status then
    raise exception 'cannot move issue from % to %', old.status, new.status using errcode = '23514';
  end if;

  -- Field-level guard only applies to end users (service role/API is checked in
  -- the service layer) and is bypassed for updates made by system triggers.
  if v_actor is not null and not app.in_system_update() then
    v_manager := app.has_permission(v_actor, 'issue:update', new.org_id, old.campus_id, old.department_id);
    if not v_manager then
      if v_actor = old.assignee_id then
        if new.status <> old.status and new.status not in ('acknowledged', 'in_progress', 'on_hold', 'resolved') then
          raise exception 'assignees can only acknowledge, progress, hold or resolve issues' using errcode = '42501';
        end if;
        v_allowed := array['status', 'resolution_notes', 'updated_at', 'updated_by', 'first_response_at',
                           'resolved_at', 'closed_at'];
      elsif v_actor = old.reporter_id
         or (old.is_anonymous and old.reporter_token is not null and old.reporter_token = app.reporter_token(old.id, v_actor)) then
        if new.status <> old.status and not (
             (old.status in ('resolved', 'closed') and new.status = 'reopened')
          or (old.status = 'resolved' and new.status = 'closed')
          or (old.status = 'open' and new.status = 'cancelled')) then
          raise exception 'reporters can only close, reopen or cancel their issues' using errcode = '42501';
        end if;
        v_allowed := array['status', 'rating', 'feedback', 'feedback_at', 'updated_at', 'updated_by',
                           'title', 'description', 'closed_at', 'reopened_count'];
        if old.status <> 'open' and (new.title <> old.title or new.description is distinct from old.description) then
          raise exception 'issue can only be edited while open' using errcode = '42501';
        end if;
      else
        raise exception 'not allowed to update this issue' using errcode = '42501';
      end if;
      if exists (select 1 from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
                 where n.value is distinct from o.value and not key = any (v_allowed)) then
        raise exception 'not allowed to change these fields' using errcode = '42501';
      end if;
    end if;
  end if;

  -- automatic timestamps / counters
  if new.status <> old.status then
    if old.status in ('open', 'reopened', 'assigned') and new.first_response_at is null
       and new.status in ('acknowledged', 'in_progress', 'on_hold', 'resolved') then
      new.first_response_at := now();
    end if;
    if new.status = 'resolved' then new.resolved_at := now(); end if;
    if new.status = 'closed' then new.closed_at := now(); end if;
    if new.status = 'reopened' then
      new.reopened_count := old.reopened_count + 1;
      new.resolved_at := null;
      new.closed_at := null;
      new.escalation_level := 0;
      new.resolution_due_at := greatest(old.resolution_due_at, now() + (old.resolution_due_at - old.created_at) / 2);
    end if;
  end if;
  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null
     and new.status in ('open', 'reopened') then
    new.status := 'assigned';
  end if;
  if new.rating is distinct from old.rating then new.feedback_at := now(); end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION app.can_read_entity(p_entity_type text, p_entity_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare
  r app.entity_registry;
  v_org uuid;
  v_campus uuid;
  v_dept uuid;
  v_owner boolean := false;
  v_sql text;
  v_col text;
  v_owner_expr text := 'false';
begin
  if auth.uid() is null then return false; end if;
  select * into r from app.entity_registry where entity_type = p_entity_type;
  if not found then return false; end if;
  foreach v_col in array r.owner_cols loop
    v_owner_expr := v_owner_expr || format(' or %I = %L', v_col, auth.uid());
  end loop;
  v_sql := format('select org_id, %s, %s, (%s) from %s where id = $1',
    coalesce(quote_ident(r.campus_col), 'null::uuid'), coalesce(quote_ident(r.dept_col), 'null::uuid'),
    v_owner_expr, r.table_name);
  execute v_sql into v_org, v_campus, v_dept, v_owner using p_entity_id;
  if v_org is null then return false; end if;
  if v_owner then return app.is_member(v_org); end if;
  -- the person who reported an issue anonymously keeps access to it
  if p_entity_type = 'issue' and app.is_my_anonymous_issue(p_entity_id) then return app.is_member(v_org); end if;
  -- task visibility is membership based rather than purely permission based
  if p_entity_type in ('task', 'project') then
    return app.can_read_task_entity(p_entity_type, p_entity_id);
  end if;
  return app.can(r.resource || ':read', v_org, v_campus, v_dept);
end $function$;

CREATE OR REPLACE FUNCTION app.issues_after_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare
  c public.issue_categories;
  v_wo uuid;
  v_project uuid;
  v_task uuid;
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform app.notify(new.org_id, new.assignee_id, 'issue.assigned', 'Issue assigned: ' || new.number,
      new.title, 'issue', new.id, '/facility/issues/' || new.id);
  end if;
  if tg_op = 'UPDATE' and new.status <> old.status
     and coalesce(new.reporter_id, (select ri.user_id from public.issue_reporter_identities ri where ri.issue_id = new.id)) is not null then
    perform app.notify(new.org_id,
      coalesce(new.reporter_id, (select ri.user_id from public.issue_reporter_identities ri where ri.issue_id = new.id)),
      'issue.status_changed',
      new.number || ' is now ' || replace(new.status, '_', ' '), new.title, 'issue', new.id, '/facility/issues/' || new.id);
  end if;
  if tg_op = 'UPDATE' and new.rating is not null and old.rating is null and new.vendor_id is not null then
    insert into public.vendor_ratings (org_id, vendor_id, source_type, source_id, rating, comment, rated_by)
    values (new.org_id, new.vendor_id, 'issue', new.id, new.rating, new.feedback, new.reporter_id)
    on conflict do nothing;
  end if;

  if tg_op = 'INSERT' and new.category_id is not null then
    select * into c from public.issue_categories where id = new.category_id;
    if c.auto_create = 'work_order' then
      insert into public.work_orders (org_id, campus_id, title, description, type, priority, asset_id, location_id,
        issue_id, assignee_id, vendor_id, due_at, number)
      values (new.org_id, new.campus_id, new.title, new.description, 'corrective', new.priority, new.asset_id,
        new.location_id, new.id, new.assignee_id, new.vendor_id, new.resolution_due_at, '')
      returning id into v_wo;
      perform app.begin_system_update();
      update public.issues set work_order_id = v_wo where id = new.id;
      perform app.end_system_update();
    elsif c.auto_create = 'task' then
      select (settings ->> 'issue_task_project_id')::uuid into v_project
      from public.org_modules where org_id = new.org_id and module = 'tasks' and enabled;
      execute 'insert into public.tasks (org_id, project_id, title, description, priority, due_date, created_by)
               values ($1, $2, $3, $4, $5, $6::date, $7) returning id'
        into v_task
        using new.org_id, v_project, new.number || ': ' || new.title, new.description,
              case new.priority when 'critical' then 'urgent' else new.priority end,
              new.resolution_due_at, new.reporter_id;
      if new.assignee_id is not null then
        execute 'insert into public.task_assignees (task_id, user_id, org_id) values ($1, $2, $3)'
          using v_task, new.assignee_id, new.org_id;
      end if;
      execute 'insert into public.task_links (org_id, task_id, entity_type, entity_id) values ($1, $2, ''issue'', $3)'
        using new.org_id, v_task, new.id;
      perform app.begin_system_update();
      update public.issues set task_id = v_task where id = new.id;
      perform app.end_system_update();
    end if;
  end if;
  return null;
end $function$;
