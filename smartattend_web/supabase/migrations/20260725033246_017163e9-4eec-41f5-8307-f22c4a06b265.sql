CREATE OR REPLACE FUNCTION public.is_course_instructor(_course_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id = _course_id AND c.instructor_id = _user_id
  )
$$;
REVOKE ALL ON FUNCTION public.is_course_instructor(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_course_instructor(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_enrolled_student(_course_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.course_enrollments ce
    WHERE ce.course_id = _course_id AND ce.student_id = _user_id
  )
$$;
REVOKE ALL ON FUNCTION public.is_enrolled_student(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_enrolled_student(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Instructors view own course rosters" ON public.course_enrollments;
CREATE POLICY "Instructors view own course rosters" ON public.course_enrollments
  FOR SELECT TO authenticated USING (public.is_course_instructor(course_id, auth.uid()));

DROP POLICY IF EXISTS "Enrolled students view their course" ON public.courses;
CREATE POLICY "Enrolled students view their course" ON public.courses
  FOR SELECT TO authenticated USING (public.is_enrolled_student(id, auth.uid()));