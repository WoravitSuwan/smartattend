-- Restrict execution of security definer helper: only signed-in users (needed for RLS policies) may call it
revoke execute on function public.has_role(uuid, public.app_role) from public;
revoke execute on function public.has_role(uuid, public.app_role) from anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.has_role(uuid, public.app_role) to service_role;

-- Trigger helper should not be directly callable by API roles at all
revoke execute on function public.update_updated_at_column() from public;
revoke execute on function public.update_updated_at_column() from anon;
revoke execute on function public.update_updated_at_column() from authenticated;