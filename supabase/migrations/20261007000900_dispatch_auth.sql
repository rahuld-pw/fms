-- -----------------------------------------------------------------------------
-- Dispatcher authentication without handing out the service-role key.
-- pg_cron calls the Edge Functions with a random token kept in Vault
-- ("dispatch_token"); the functions verify it with public.dispatch_config(),
-- which also returns deployment settings such as the public app URL
-- (Vault secret "app_url").
-- -----------------------------------------------------------------------------
create or replace function public.dispatch_config(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_expected text;
begin
  if not app.is_service() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_token'$q$ into v_expected;
  if v_expected is null or p_token is null or p_token <> v_expected then
    return null;
  end if;
  return jsonb_build_object('app_url',
    (select decrypted_secret from vault.decrypted_secrets where name = 'app_url'));
end $$;
revoke execute on function public.dispatch_config(text) from public, anon, authenticated;
grant execute on function public.dispatch_config(text) to service_role;

do $dispatch$
begin
  if to_regclass('vault.secrets') is null then
    return;
  end if;
  if not exists (select 1 from vault.secrets where name = 'dispatch_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'dispatch_token',
      'Bearer token pg_cron uses to call the dispatch Edge Functions');
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('dispatch-webhooks', '* * * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/dispatch-webhooks',
        headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_token'),
                                      'Content-Type', 'application/json'),
        body := '{}'::jsonb)
      where exists (select 1 from public.webhook_deliveries where status in ('pending', 'failed') and next_attempt_at <= now())
    $job$);
    perform cron.schedule('dispatch-messages', '* * * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/dispatch-messages',
        headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_token'),
                                      'Content-Type', 'application/json'),
        body := '{}'::jsonb)
      where exists (select 1 from public.message_outbox where status = 'pending' and send_after <= now())
    $job$);
  end if;
end
$dispatch$;
