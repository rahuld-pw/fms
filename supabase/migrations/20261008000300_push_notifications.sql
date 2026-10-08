-- Web push notifications for the installed app (PWA) and desktop browsers.
-- A notification that shows in the app (in-app preference on) is also pushed
-- to every device the user turned push on for, through the message outbox.

-- Devices that receive push notifications (one row per browser subscription).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);
create index on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- VAPID key pair identifying this deployment to push services. Created by the
-- app on first use, so there is nothing to configure. Never exposed to users.
create table app.push_keys (
  id boolean primary key default true check (id),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);
revoke all on app.push_keys from public, anon, authenticated;

create or replace function public.push_vapid_keys(p_public text default null, p_private text default null)
returns jsonb language plpgsql security definer set search_path = public, app as $$
begin
  if p_public is not null and p_private is not null then
    insert into app.push_keys (public_key, private_key) values (p_public, p_private) on conflict (id) do nothing;
  end if;
  return (select jsonb_build_object('public_key', public_key, 'private_key', private_key) from app.push_keys);
end $$;
revoke execute on function public.push_vapid_keys(text, text) from public, anon, authenticated;
grant execute on function public.push_vapid_keys(text, text) to service_role;

-- The outbox gets a "push" channel (recipient = user id).
alter table public.message_outbox drop constraint if exists message_outbox_channel_check;
alter table public.message_outbox add constraint message_outbox_channel_check check (channel in ('email', 'whatsapp', 'sms', 'push'));

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
  if v_in_app and exists (select 1 from public.push_subscriptions where user_id = p_user) then
    perform app.queue_message(p_org, 'push', p_user::text, 'notification', p_title,
      jsonb_build_object('title', p_title, 'body', p_body, 'link', p_link, 'type', p_type));
  end if;
end $$;
