-- Personal-workspace onboarding is for signed-in users only.
revoke execute on function public.create_personal_workspace() from public, anon;
revoke execute on function public.my_pending_invitations() from public, anon;
grant execute on function public.create_personal_workspace() to authenticated, service_role;
grant execute on function public.my_pending_invitations() to authenticated, service_role;
