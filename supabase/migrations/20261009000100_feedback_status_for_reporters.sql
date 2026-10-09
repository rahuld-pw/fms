-- -----------------------------------------------------------------------------
-- Reporters follow their bug reports and feature requests: a reply from the
-- platform team they can read, internal notes they can't, and a notification
-- when either the status or the reply changes.
-- -----------------------------------------------------------------------------
alter table public.feedback add column if not exists reply text check (length(reply) <= 5000);

-- Row access stays as it is (own rows, or platform admins). Column access hides
-- the internal notes, the reporter's browser string and email from signed-in
-- clients; the platform console reads feedback with the service role.
revoke select on public.feedback from anon, authenticated;
grant select (id, kind, title, description, page_url, user_id, org_id, status, reply, votes, created_at, updated_at)
  on public.feedback to authenticated;

create or replace function app.feedback_notify_reporter() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_what text := case new.kind when 'bug' then 'bug report' when 'feature' then 'feature request' else 'feedback' end;
  v_status text := replace(new.status, '_', ' ');
begin
  if new.user_id is null or new.org_id is null then return new; end if;
  if new.status is distinct from old.status then
    perform app.notify(new.org_id, new.user_id, 'feedback.updated',
      format('Your %s is now %s', v_what, v_status), new.title, 'feedback', new.id, '/settings/feedback');
  elsif new.reply is distinct from old.reply and coalesce(new.reply, '') <> '' then
    perform app.notify(new.org_id, new.user_id, 'feedback.updated',
      format('Reply to your %s', v_what), new.title, 'feedback', new.id, '/settings/feedback');
  end if;
  return new;
end $$;

drop trigger if exists feedback_notify_reporter on public.feedback;
create trigger feedback_notify_reporter after update of status, reply on public.feedback
  for each row execute function app.feedback_notify_reporter();
