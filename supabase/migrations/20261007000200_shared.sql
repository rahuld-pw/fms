-- =============================================================================
-- Shared / platform tables: entity registry, audit log, attachments, comments,
-- tags, custom fields, notifications, API keys, rate limiting, idempotency,
-- outbound webhooks (events outbox) and message outbox (email/WhatsApp hooks).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Entity registry: describes every business entity so polymorphic tables
-- (attachments, comments, tags, custom fields, approvals, search) can resolve
-- an (entity_type, entity_id) pair to a table, its hierarchy scope and the
-- permission needed to read it.
-- -----------------------------------------------------------------------------
create table app.entity_registry (
  entity_type text primary key,
  table_name regclass not null,
  resource text not null,               -- permission resource prefix
  module text,
  campus_col text,
  dept_col text,
  owner_cols text[] not null default '{}',
  title_col text not null default 'title',
  number_col text,
  url_template text                     -- UI link, e.g. '/facility/issues/{id}'
);
grant select on app.entity_registry to authenticated, service_role;

-- Can the current user read the given entity? Used by polymorphic RLS.
create or replace function app.can_read_entity(p_entity_type text, p_entity_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public, app as $$
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
  -- task visibility is membership based rather than purely permission based
  if p_entity_type in ('task', 'project') then
    return app.can_read_task_entity(p_entity_type, p_entity_id);
  end if;
  return app.can(r.resource || ':read', v_org, v_campus, v_dept);
end $$;

-- Placeholder, replaced by the tasks migration.
create or replace function app.can_read_task_entity(p_entity_type text, p_entity_id uuid)
returns boolean language sql stable as $$ select false $$;

-- -----------------------------------------------------------------------------
-- Activity log / audit trail (append-only)
-- -----------------------------------------------------------------------------
create table public.activity_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organisations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,                 -- created, updated, deleted, status_changed, commented, approved ...
  actor_id uuid references public.profiles(id) on delete set null,
  actor_type text not null default 'user',
  api_key_id uuid,
  changes jsonb,                        -- {"field": [old, new]}
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.activity_log (org_id, entity_type, entity_id, created_at desc);
create index on public.activity_log (org_id, created_at desc);
create index on public.activity_log (actor_id, created_at desc);

alter table public.activity_log enable row level security;
create policy activity_select on public.activity_log for select to authenticated
  using (app.can('audit:read', org_id, null, null, true)
         or (org_id in (select app.my_org_ids()) and app.can_read_entity(entity_type, entity_id)));
-- no insert/update/delete policies: written only by triggers / security definer functions

create or replace function app.log_activity(
  p_org uuid, p_entity_type text, p_entity_id uuid, p_action text,
  p_changes jsonb default null, p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  insert into public.activity_log (org_id, entity_type, entity_id, action, actor_id, actor_type, api_key_id, changes, metadata)
  values (p_org, p_entity_type, p_entity_id, p_action, app.actor_id(), app.actor_type(),
          nullif(app.request_header('x-actor-api-key-id'), '')::uuid, p_changes, coalesce(p_metadata, '{}'::jsonb));
exception when invalid_text_representation then
  insert into public.activity_log (org_id, entity_type, entity_id, action, actor_id, actor_type, changes, metadata)
  values (p_org, p_entity_type, p_entity_id, p_action, app.actor_id(), app.actor_type(), p_changes, coalesce(p_metadata, '{}'::jsonb));
end $$;

-- Generic audit trigger: tg_argv[0] = entity_type.
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

create or replace function app.add_audit(p_table regclass, p_entity_type text) returns void
language plpgsql as $$
begin
  execute format('create trigger audit after insert or update or delete on %s
    for each row execute function app.audit_trigger(%L)', p_table, p_entity_type);
end $$;

-- -----------------------------------------------------------------------------
-- Events outbox + outbound webhooks
-- -----------------------------------------------------------------------------
create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  url text not null check (url ~ '^https?://'),
  description text,
  secret text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  events text[] not null default '{*}',
  active boolean not null default true,
  consecutive_failures int not null default 0,
  disabled_reason text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.webhook_endpoints (org_id) where active;

create table public.events_outbox (
  id bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid() unique,
  org_id uuid not null references public.organisations(id) on delete cascade,
  event_type text not null,             -- e.g. issue.created, po.approved
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index on public.events_outbox (org_id, created_at desc);
create index on public.events_outbox (created_at) where processed_at is null;

create table public.webhook_deliveries (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organisations(id) on delete cascade,
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  event_id bigint not null references public.events_outbox(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'in_flight', 'succeeded', 'failed', 'dead')),
  attempt_count int not null default 0,
  max_attempts int not null default 8,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_status_code int,
  last_error text,
  last_response_excerpt text,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.webhook_deliveries (next_attempt_at) where status in ('pending', 'failed');
create index on public.webhook_deliveries (endpoint_id, created_at desc);

alter table public.webhook_endpoints enable row level security;
create policy webhooks_admin on public.webhook_endpoints for all to authenticated
  using (app.can('webhook:manage', org_id, null, null, true))
  with check (app.can('webhook:manage', org_id, null, null, true));
alter table public.events_outbox enable row level security;
create policy outbox_admin on public.events_outbox for select to authenticated
  using (app.can('webhook:manage', org_id, null, null, true));
alter table public.webhook_deliveries enable row level security;
create policy deliveries_admin on public.webhook_deliveries for select to authenticated
  using (app.can('webhook:manage', org_id, null, null, true));

-- Records a domain event and fans it out to subscribed endpoints.
create or replace function app.emit_event(
  p_org uuid, p_event_type text, p_entity_type text, p_entity_id uuid, p_payload jsonb default '{}'::jsonb
) returns bigint
language plpgsql security definer set search_path = public, app as $$
declare
  v_id bigint;
begin
  insert into public.events_outbox (org_id, event_type, entity_type, entity_id, payload)
  values (p_org, p_event_type, p_entity_type, p_entity_id, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;

  insert into public.webhook_deliveries (org_id, endpoint_id, event_id)
  select p_org, e.id, v_id
  from public.webhook_endpoints e
  where e.org_id = p_org and e.active
    and ('*' = any (e.events) or p_event_type = any (e.events)
         or split_part(p_event_type, '.', 1) || '.*' = any (e.events));
  return v_id;
end $$;

-- Row-level event trigger: tg_argv[0] = event prefix (e.g. 'issue').
-- Emits <prefix>.created, <prefix>.updated, <prefix>.status_changed, <prefix>.deleted.
create or replace function app.event_trigger() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_row jsonb;
  v_type text;
  v_payload jsonb;
begin
  if tg_op = 'INSERT' then
    v_type := tg_argv[0] || '.created';
    v_row := to_jsonb(new);
  else
    v_row := to_jsonb(new);
    if (to_jsonb(old) ->> 'deleted_at') is null and (v_row ->> 'deleted_at') is not null then
      v_type := tg_argv[0] || '.deleted';
    elsif (to_jsonb(old) ->> 'status') is distinct from (v_row ->> 'status') then
      v_type := tg_argv[0] || '.status_changed';
    else
      v_type := tg_argv[0] || '.updated';
    end if;
  end if;
  v_row := v_row - array['tracking_token_hash', 'search_vector', 'invite_token_hash', 'secret', 'key_hash'];
  v_payload := jsonb_build_object('data', v_row);
  if tg_op = 'UPDATE' and v_type like '%.status_changed' then
    v_payload := v_payload || jsonb_build_object('previous_status', to_jsonb(old) ->> 'status');
  end if;
  perform app.emit_event((v_row ->> 'org_id')::uuid, v_type, tg_argv[0], (v_row ->> 'id')::uuid, v_payload);
  return new;
end $$;

create or replace function app.add_events(p_table regclass, p_prefix text) returns void
language plpgsql as $$
begin
  execute format('create trigger emit_events after insert or update on %s
    for each row execute function app.event_trigger(%L)', p_table, p_prefix);
end $$;

-- Claim a batch of due deliveries (used by the webhook dispatcher).
create or replace function public.claim_webhook_deliveries(p_limit int default 50)
returns table (
  delivery_id bigint, endpoint_id uuid, url text, secret text, attempt_count int,
  event_id uuid, event_type text, org_id uuid, payload jsonb, created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not app.is_service() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  with due as (
    select d.id from public.webhook_deliveries d
    where d.status in ('pending', 'failed') and d.next_attempt_at <= now()
      and (d.locked_until is null or d.locked_until < now())
    order by d.next_attempt_at
    limit p_limit
    for update skip locked
  ), upd as (
    update public.webhook_deliveries d
    set status = 'in_flight', locked_until = now() + interval '2 minutes', attempt_count = d.attempt_count + 1,
        last_attempt_at = now()
    from due where d.id = due.id
    returning d.*
  )
  select u.id, e.id, e.url, e.secret, u.attempt_count, o.event_id, o.event_type, o.org_id, o.payload, o.created_at
  from upd u
  join public.webhook_endpoints e on e.id = u.endpoint_id
  join public.events_outbox o on o.id = u.event_id;
end $$;

-- Record the outcome of a delivery attempt; exponential backoff on failure.
create or replace function public.complete_webhook_delivery(
  p_delivery_id bigint, p_success boolean, p_status_code int default null,
  p_error text default null, p_response_excerpt text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.webhook_deliveries;
begin
  if not app.is_service() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into d from public.webhook_deliveries where id = p_delivery_id for update;
  if not found then return; end if;
  if p_success then
    update public.webhook_deliveries set status = 'succeeded', delivered_at = now(), locked_until = null,
      last_status_code = p_status_code, last_error = null, last_response_excerpt = left(p_response_excerpt, 1000)
    where id = p_delivery_id;
    update public.webhook_endpoints set consecutive_failures = 0 where id = d.endpoint_id;
  else
    update public.webhook_deliveries set
      status = case when d.attempt_count >= d.max_attempts then 'dead' else 'failed' end,
      locked_until = null,
      -- 1m, 2m, 4m, 8m ... capped at 6h, with jitter
      next_attempt_at = now() + least(interval '6 hours',
        (interval '1 minute' * power(2, greatest(d.attempt_count - 1, 0)))) + (random() * interval '20 seconds'),
      last_status_code = p_status_code, last_error = left(p_error, 1000),
      last_response_excerpt = left(p_response_excerpt, 1000)
    where id = p_delivery_id;
    update public.webhook_endpoints set
      consecutive_failures = consecutive_failures + 1,
      active = case when consecutive_failures + 1 >= 50 then false else active end,
      disabled_reason = case when consecutive_failures + 1 >= 50 then 'Disabled after 50 consecutive failures' else disabled_reason end
    where id = d.endpoint_id;
  end if;
end $$;

revoke execute on function public.claim_webhook_deliveries(int) from public, anon, authenticated;
revoke execute on function public.complete_webhook_delivery(bigint, boolean, int, text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Outbound message hooks (email / WhatsApp / SMS). Providers are plugged in by
-- the `dispatch-messages` edge function; rows are queued by reminders etc.
-- -----------------------------------------------------------------------------
create table public.message_outbox (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organisations(id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp', 'sms')),
  recipient text not null,
  template text not null,
  subject text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  dedupe_key text,
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index message_outbox_dedupe on public.message_outbox (org_id, dedupe_key) where dedupe_key is not null;
create index on public.message_outbox (send_after) where status = 'pending';
alter table public.message_outbox enable row level security;
create policy message_outbox_admin on public.message_outbox for select to authenticated
  using (app.can('settings:manage', org_id, null, null, true));

create or replace function app.queue_message(
  p_org uuid, p_channel text, p_recipient text, p_template text, p_subject text,
  p_payload jsonb, p_dedupe_key text default null, p_send_after timestamptz default now()
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_recipient is null or length(p_recipient) = 0 then return; end if;
  insert into public.message_outbox (org_id, channel, recipient, template, subject, payload, dedupe_key, send_after)
  values (p_org, p_channel, p_recipient, p_template, p_subject, coalesce(p_payload, '{}'), p_dedupe_key, p_send_after)
  on conflict do nothing;
end $$;

-- -----------------------------------------------------------------------------
-- Notifications (in-app + email, with per-user preferences)
-- -----------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,                   -- e.g. approval.requested, issue.assigned, task.mentioned
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  link text,
  read_at timestamptz,
  email_status text not null default 'none' check (email_status in ('none', 'pending', 'sent', 'failed')),
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, org_id, created_at desc);
create index on public.notifications (user_id) where read_at is null;

create table public.notification_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  type text not null,                   -- notification type, or '*' for default
  in_app boolean not null default true,
  email boolean not null default true,
  primary key (user_id, org_id, type)
);

alter table public.notifications enable row level security;
create policy notifications_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

alter table public.notification_preferences enable row level security;
create policy notif_prefs_own on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create or replace function app.notify(
  p_org uuid, p_user uuid, p_type text, p_title text, p_body text default null,
  p_entity_type text default null, p_entity_id uuid default null, p_link text default null
) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_in_app boolean;
  v_email boolean;
  v_addr text;
begin
  if p_user is null then return; end if;
  -- don't notify people about their own actions
  if p_user = app.actor_id() and p_type not like 'reminder.%' then return; end if;
  select coalesce(sp.in_app, dp.in_app, true), coalesce(sp.email, dp.email, true)
    into v_in_app, v_email
  from (select 1) x
  left join public.notification_preferences sp on sp.user_id = p_user and sp.org_id = p_org and sp.type = p_type
  left join public.notification_preferences dp on dp.user_id = p_user and dp.org_id = p_org and dp.type = '*';

  if v_in_app or v_email then
    insert into public.notifications (org_id, user_id, type, title, body, entity_type, entity_id, link, email_status, read_at)
    values (p_org, p_user, p_type, p_title, p_body, p_entity_type, p_entity_id, p_link,
            case when v_email then 'pending' else 'none' end,
            case when v_in_app then null else now() end);
  end if;
  if v_email then
    select email into v_addr from public.profiles where id = p_user;
    perform app.queue_message(p_org, 'email', v_addr, 'notification', p_title,
      jsonb_build_object('title', p_title, 'body', p_body, 'link', p_link, 'type', p_type));
  end if;
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns int language sql security invoker as $$
  with u as (
    update public.notifications set read_at = now()
    where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids))
    returning 1)
  select count(*)::int from u
$$;

-- -----------------------------------------------------------------------------
-- Attachments (files live in Supabase Storage under <org_id>/<entity_type>/...)
-- -----------------------------------------------------------------------------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  bucket text not null default 'attachments',
  path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes >= 0),
  kind text,                             -- photo, receipt, document, report, quote ...
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (path like org_id::text || '/%')
);
create index on public.attachments (org_id, entity_type, entity_id) where deleted_at is null;

alter table public.attachments enable row level security;
create policy attachments_select on public.attachments for select to authenticated
  using (org_id in (select app.my_org_ids()) and app.can_read_entity(entity_type, entity_id));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (org_id in (select app.my_org_ids()) and app.can_read_entity(entity_type, entity_id)
              and uploaded_by = (select auth.uid()));
create policy attachments_update on public.attachments for update to authenticated
  using (uploaded_by = (select auth.uid()) or app.can('attachment:manage', org_id))
  with check (org_id in (select app.my_org_ids()));

-- -----------------------------------------------------------------------------
-- Comments (with @mentions)
-- -----------------------------------------------------------------------------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null check (length(body) between 1 and 20000),
  mentions uuid[] not null default '{}',
  is_internal boolean not null default false,  -- hidden from vendor portal / anonymous reporters
  author_id uuid references public.profiles(id) on delete set null,
  author_label text,                            -- vendor / anonymous reporter display name
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.comments (org_id, entity_type, entity_id, created_at) where deleted_at is null;

alter table public.comments enable row level security;
create policy comments_select on public.comments for select to authenticated
  using (org_id in (select app.my_org_ids()) and app.can_read_entity(entity_type, entity_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (org_id in (select app.my_org_ids()) and app.can_read_entity(entity_type, entity_id)
              and author_id = (select auth.uid()));
create policy comments_update on public.comments for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
select app.add_standard_triggers('public.comments');

create or replace function app.comment_after_insert() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_user uuid;
  r app.entity_registry;
  v_link text;
begin
  select * into r from app.entity_registry where entity_type = new.entity_type;
  v_link := replace(coalesce(r.url_template, ''), '{id}', new.entity_id::text);
  foreach v_user in array new.mentions loop
    if exists (select 1 from public.org_members where org_id = new.org_id and user_id = v_user and status = 'active') then
      perform app.notify(new.org_id, v_user, 'comment.mentioned', 'You were mentioned in a comment',
        left(new.body, 280), new.entity_type, new.entity_id, nullif(v_link, ''));
    end if;
  end loop;
  perform app.log_activity(new.org_id, new.entity_type, new.entity_id, 'commented', null,
    jsonb_build_object('comment_id', new.id));
  perform app.emit_event(new.org_id, 'comment.created', new.entity_type, new.entity_id,
    jsonb_build_object('data', to_jsonb(new)));
  return new;
end $$;
create trigger comment_after_insert after insert on public.comments
  for each row execute function app.comment_after_insert();

-- -----------------------------------------------------------------------------
-- Tags
-- -----------------------------------------------------------------------------
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (length(name) between 1 and 48),
  color text not null default 'gray',
  created_at timestamptz not null default now()
);
create unique index tags_org_name on public.tags (org_id, lower(name));

create table public.taggings (
  tag_id uuid not null references public.tags(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tag_id, entity_type, entity_id)
);
create index on public.taggings (org_id, entity_type, entity_id);

alter table public.tags enable row level security;
create policy tags_select on public.tags for select to authenticated using (org_id in (select app.my_org_ids()));
create policy tags_write on public.tags for all to authenticated
  using (org_id in (select app.my_org_ids())) with check (org_id in (select app.my_org_ids()));
alter table public.taggings enable row level security;
create policy taggings_select on public.taggings for select to authenticated
  using (org_id in (select app.my_org_ids()) and app.can_read_entity(entity_type, entity_id));
create policy taggings_write on public.taggings for all to authenticated
  using (org_id in (select app.my_org_ids()) and app.can_read_entity(entity_type, entity_id))
  with check (org_id in (select app.my_org_ids()) and app.can_read_entity(entity_type, entity_id));

-- -----------------------------------------------------------------------------
-- Custom fields
-- -----------------------------------------------------------------------------
create table public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  entity_type text not null,
  scope_id uuid,                        -- optional: e.g. a project id for task fields
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,47}$'),
  label text not null,
  field_type text not null check (field_type in ('text', 'number', 'date', 'boolean', 'select', 'multiselect', 'user', 'currency')),
  options jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index cfd_uniq on public.custom_field_definitions
  (org_id, entity_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create table public.custom_field_values (
  definition_id uuid not null references public.custom_field_definitions(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (definition_id, entity_id)
);
create index on public.custom_field_values (org_id, entity_type, entity_id);

alter table public.custom_field_definitions enable row level security;
create policy cfd_select on public.custom_field_definitions for select to authenticated
  using (org_id in (select app.my_org_ids()));
create policy cfd_write on public.custom_field_definitions for all to authenticated
  using (app.can('settings:manage', org_id, null, null, true) or app.can('project:update', org_id))
  with check (app.can('settings:manage', org_id, null, null, true) or app.can('project:update', org_id));
alter table public.custom_field_values enable row level security;
create policy cfv_select on public.custom_field_values for select to authenticated
  using (org_id in (select app.my_org_ids()) and app.can_read_entity(entity_type, entity_id));
create policy cfv_write on public.custom_field_values for all to authenticated
  using (org_id in (select app.my_org_ids()) and app.can_read_entity(entity_type, entity_id))
  with check (org_id in (select app.my_org_ids()) and app.can_read_entity(entity_type, entity_id));

-- -----------------------------------------------------------------------------
-- API keys (hashed, scoped, revocable, rate-limited)
-- Key format: co_live_<prefix>_<secret>; only sha256(key) is stored.
-- -----------------------------------------------------------------------------
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  prefix text not null unique,
  key_hash text not null unique,
  scopes text[] not null default '{}',  -- permission keys, e.g. {issue:read,issue:create}
  rate_limit_per_minute int not null default 120 check (rate_limit_per_minute between 1 and 10000),
  created_by uuid not null references public.profiles(id),
  last_used_at timestamptz,
  last_used_ip text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.api_keys (org_id);

alter table public.api_keys enable row level security;
create policy api_keys_admin on public.api_keys for all to authenticated
  using (app.can('api_key:manage', org_id, null, null, true))
  with check (app.can('api_key:manage', org_id, null, null, true));

-- Resolve a presented key hash. Service role only (called by the API layer).
create or replace function public.resolve_api_key(p_key_hash text)
returns table (id uuid, org_id uuid, scopes text[], rate_limit_per_minute int, created_by uuid)
language plpgsql security definer set search_path = public as $$
begin
  if not app.is_service() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  update public.api_keys k set last_used_at = now()
  where k.key_hash = p_key_hash and k.revoked_at is null and (k.expires_at is null or k.expires_at > now())
    -- the creator must still be an active member
    and exists (select 1 from public.org_members m where m.org_id = k.org_id and m.user_id = k.created_by and m.status = 'active')
  returning k.id, k.org_id, k.scopes, k.rate_limit_per_minute, k.created_by;
end $$;
revoke execute on function public.resolve_api_key(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Rate limiting (fixed window counters; no Redis needed on serverless)
-- -----------------------------------------------------------------------------
create unlogged table app.rate_limit_counters (
  bucket text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, window_start)
);

create or replace function public.rate_limit_hit(p_bucket text, p_limit int, p_window_seconds int default 60)
returns table (allowed boolean, remaining int, reset_at timestamptz)
language plpgsql security definer set search_path = public, app as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into app.rate_limit_counters as c (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = c.hits + 1
  returning c.hits into v_hits;
  return query select v_hits <= p_limit, greatest(p_limit - v_hits, 0),
    v_window + make_interval(secs => p_window_seconds);
end $$;
revoke execute on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;

-- -----------------------------------------------------------------------------
-- Idempotency keys for POST/PATCH requests
-- -----------------------------------------------------------------------------
create table app.idempotency_keys (
  scope text not null,                  -- org_id:principal
  key text not null,
  request_hash text not null,
  method text not null,
  path text not null,
  status_code int,
  response jsonb,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  primary key (scope, key)
);

-- Returns the stored response if this key was already completed, 'conflict'
-- if it is in progress / reused with a different payload, or 'proceed'.
create or replace function public.idempotency_begin(
  p_scope text, p_key text, p_request_hash text, p_method text, p_path text
) returns table (state text, status_code int, response jsonb)
language plpgsql security definer set search_path = public, app as $$
declare
  r app.idempotency_keys;
begin
  insert into app.idempotency_keys (scope, key, request_hash, method, path, locked_until)
  values (p_scope, p_key, p_request_hash, p_method, p_path, now() + interval '1 minute')
  on conflict do nothing;
  if found then
    return query select 'proceed'::text, null::int, null::jsonb;
    return;
  end if;
  select * into r from app.idempotency_keys where scope = p_scope and key = p_key for update;
  if r.request_hash <> p_request_hash or r.method <> p_method or r.path <> p_path then
    return query select 'mismatch'::text, null::int, null::jsonb;
  elsif r.status_code is not null then
    return query select 'replay'::text, r.status_code, r.response;
  elsif r.locked_until > now() then
    return query select 'in_progress'::text, null::int, null::jsonb;
  else
    update app.idempotency_keys set locked_until = now() + interval '1 minute' where scope = p_scope and key = p_key;
    return query select 'proceed'::text, null::int, null::jsonb;
  end if;
end $$;

create or replace function public.idempotency_complete(p_scope text, p_key text, p_status_code int, p_response jsonb)
returns void language sql security definer set search_path = public, app as $$
  update app.idempotency_keys set status_code = p_status_code, response = p_response, locked_until = null
  where scope = p_scope and key = p_key
$$;

create or replace function public.idempotency_release(p_scope text, p_key text)
returns void language sql security definer set search_path = public, app as $$
  delete from app.idempotency_keys where scope = p_scope and key = p_key and status_code is null
$$;
revoke execute on function public.idempotency_begin(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.idempotency_complete(text, text, int, jsonb) from public, anon, authenticated;
revoke execute on function public.idempotency_release(text, text) from public, anon, authenticated;

-- Housekeeping, scheduled by pg_cron.
create or replace function app.cleanup_ephemeral() returns void
language sql security definer set search_path = public, app as $$
  delete from app.rate_limit_counters where window_start < now() - interval '1 hour';
  delete from app.idempotency_keys where created_at < now() - interval '48 hours';
  delete from public.webhook_deliveries where status = 'succeeded' and delivered_at < now() - interval '30 days';
  delete from public.events_outbox o where o.created_at < now() - interval '90 days'
    and not exists (select 1 from public.webhook_deliveries d where d.event_id = o.id and d.status not in ('succeeded', 'dead'));
  delete from public.message_outbox where status in ('sent', 'skipped') and created_at < now() - interval '30 days';
$$;

select app.add_standard_triggers('public.webhook_endpoints');
