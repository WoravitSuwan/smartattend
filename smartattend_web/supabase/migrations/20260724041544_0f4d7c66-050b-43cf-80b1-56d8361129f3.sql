CREATE POLICY "Enrolled students view their course" ON public.courses
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.course_enrollments ce
      WHERE ce.course_id = id AND ce.student_id = auth.uid()
    )
  );