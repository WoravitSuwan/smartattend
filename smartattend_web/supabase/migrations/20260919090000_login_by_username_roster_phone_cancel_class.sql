-- 1) Let students log in with just the local part of their university
-- email (e.g. "woravit_su67") instead of typing the full
-- "@rmutl.ac.th" / "@live.rmutl.ac.th" address every time.
--
-- Called before auth (anon), so it only ever returns the bare email
-- string — nothing else from the profile — and only for a match against
-- one of the two allowed institutional domains or an exact full-email
-- match (harmless no-op for someone who already typed the full address).
CREATE OR REPLACE FUNCTION public.resolve_login_email(_input text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email FROM public.profiles
  WHERE lower(email) = lower(_input)
     OR lower(email) = lower(_input) || '@rmutl.ac.th'
     OR lower(email) = lower(_input) || '@live.rmutl.ac.th'
  ORDER BY (lower(email) = lower(_input)) DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.resolve_login_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO anon, authenticated;

-- 2) Instructors need to see a phone number for students actually
-- confirmed into one of their own courses (e.g. to call/line them about
-- attendance issues). The existing "Users can view own profile" policy
-- only allows a user to see their own row (or an admin to see any row),
-- so an instructor querying `profiles` for their roster got nothing back.
CREATE POLICY "Instructors can view profiles of their confirmed students"
ON public.profiles FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.course_enrollments ce
    JOIN public.courses c ON c.id = ce.course_id
    WHERE ce.student_id = profiles.user_id
      AND ce.status = 'confirmed'
      AND c.instructor_id = auth.uid()
  )
);

-- 3) "ยกคลาส" — instructor announces there's no class today for a course,
-- without opening a session (nothing to check into). Broadcasts to every
-- confirmed student the same way start-class-session does, but as a
-- plain RPC (no service-role edge function needed) since it only ever
-- touches the calling instructor's own course.
CREATE OR REPLACE FUNCTION public.cancel_class_announcement(_course_id uuid, _reason text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _course RECORD;
  _notified INTEGER := 0;
BEGIN
  SELECT id, code, name, instructor_id INTO _course
  FROM public.courses
  WHERE id = _course_id;

  IF _course IS NULL THEN
    RAISE EXCEPTION 'course not found';
  END IF;

  IF _course.instructor_id <> auth.uid() THEN
    RAISE EXCEPTION 'not your course';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, related_id, action_required, status)
  SELECT
    ce.student_id,
    'class_cancelled',
    'คลาสถูกยกเลิก',
    _course.code || ' ' || _course.name || ' วันนี้งดการเรียนการสอน' ||
      CASE WHEN _reason IS NOT NULL AND btrim(_reason) <> '' THEN ' — ' || btrim(_reason) ELSE '' END,
    _course.id,
    false,
    'unread'
  FROM public.course_enrollments ce
  WHERE ce.course_id = _course_id AND ce.status = 'confirmed' AND ce.student_id IS NOT NULL;

  GET DIAGNOSTICS _notified = ROW_COUNT;
  RETURN _notified;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_class_announcement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_class_announcement(uuid, text) TO authenticated;
