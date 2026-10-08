-- Users for tenancy-flow.mjs (load after supabase/seed.sql). Password: Password123!
do $$
declare u record;
begin
  for u in select * from (values
    ('root@platform.test', 'Root Admin'),
    ('principal@sunrise.test', 'Dr. Mehta'),
    ('asha@public.test', 'Asha Verma')
  ) as x(email, name)
  loop
    if not exists (select 1 from auth.users where email = u.email) then
      with nu as (
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
          email_change_token_new, email_change)
        values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', u.email,
          extensions.crypt('Password123!', extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.name), now(), now(), '', '', '', '')
        returning id)
      insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      select gen_random_uuid(), nu.id::text, nu.id, jsonb_build_object('sub', nu.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
      from nu;
    end if;
  end loop;
  insert into public.platform_admins (user_id) select id from auth.users where email = 'root@platform.test' on conflict do nothing;
end $$;
