DROP POLICY IF EXISTS "Admins view all courses" ON public.student_courses;
CREATE POLICY "Admins view all courses" ON public.student_courses
  FOR SELECT TO authenticated
  USING (internal.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.has_role(uuid, app_role);