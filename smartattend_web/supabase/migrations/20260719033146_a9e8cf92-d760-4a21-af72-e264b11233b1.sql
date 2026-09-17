CREATE TABLE public.class_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  instructor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE ON public.class_sessions TO authenticated;
GRANT ALL ON public.class_sessions TO service_role;
ALTER TABLE public.class_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Instructors manage own sessions" ON public.class_sessions
  FOR ALL TO authenticated USING (instructor_id = auth.uid()) WITH CHECK (instructor_id = auth.uid());
CREATE POLICY "Enrolled students view session" ON public.class_sessions
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.course_enrollments ce WHERE ce.course_id = class_sessions.course_id AND ce.student_id = auth.uid())
  );
ALTER PUBLICATION supabase_realtime ADD TABLE public.class_sessions;

CREATE TABLE public.attendance_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.class_sessions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_data_url TEXT NOT NULL,
  confidence NUMERIC NOT NULL,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_id)
);
GRANT SELECT, INSERT ON public.attendance_records TO authenticated;
GRANT ALL ON public.attendance_records TO service_role;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Students insert own attendance" ON public.attendance_records
  FOR INSERT TO authenticated WITH CHECK (student_id = auth.uid());
CREATE POLICY "Instructors view own session attendance" ON public.attendance_records
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.class_sessions cs WHERE cs.id = attendance_records.session_id AND cs.instructor_id = auth.uid())
  );
CREATE POLICY "Students view own attendance" ON public.attendance_records
  FOR SELECT TO authenticated USING (student_id = auth.uid());
ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_records;