CREATE SCHEMA IF NOT EXISTS internal;
REVOKE ALL ON SCHEMA internal FROM PUBLIC;
GRANT USAGE ON SCHEMA internal TO authenticated, service_role;

ALTER FUNCTION public.has_role(uuid, public.app_role) SET SCHEMA internal;

REVOKE EXECUTE ON FUNCTION internal.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION internal.has_role(uuid, public.app_role) FROM anon;
GRANT EXECUTE ON FUNCTION internal.has_role(uuid, public.app_role) TO authenticated, service_role;