
-- Remove client INSERT ability and route audit writes through a SECURITY DEFINER function
DROP POLICY IF EXISTS "Authenticated users can insert own audit log" ON public.audit_logs;
REVOKE INSERT ON public.audit_logs FROM authenticated;

CREATE OR REPLACE FUNCTION public.log_audit_event(
  _action text,
  _target text DEFAULT NULL,
  _target_id text DEFAULT NULL,
  _detail text DEFAULT NULL,
  _before jsonb DEFAULT NULL,
  _after jsonb DEFAULT NULL,
  _reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _name text;
  _role text;
  _id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF _action IS NULL OR length(_action) = 0 OR length(_action) > 100 THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;

  SELECT name INTO _name FROM public.profiles WHERE user_id = _uid;

  SELECT CASE
    WHEN public.has_role(_uid, 'admin'::app_role) THEN 'admin'
    WHEN public.has_role(_uid, 'instructor'::app_role) THEN 'instructor'
    ELSE 'student'
  END INTO _role;

  INSERT INTO public.audit_logs (
    actor_id, actor_name, actor_role, action, target, target_id, detail, before, after, reason
  ) VALUES (
    _uid, _name, _role, _action, _target, _target_id,
    left(coalesce(_detail, ''), 2000),
    _before, _after,
    left(coalesce(_reason, ''), 1000)
  )
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit_event(text, text, text, text, jsonb, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, text, text, text, jsonb, jsonb, text) TO authenticated;
