CREATE TABLE public.assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_at TIMESTAMPTZ,
  max_score NUMERIC NOT NULL DEFAULT 100,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignments TO authenticated;
GRANT ALL ON public.assignments TO service_role;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Instructors manage own course assignments" ON public.assignments
  FOR ALL TO authenticated
  USING (public.is_course_instructor(course_id, auth.uid()))
  WITH CHECK (public.is_course_instructor(course_id, auth.uid()));

CREATE POLICY "Enrolled students view assignments" ON public.assignments
  FOR SELECT TO authenticated
  USING (public.is_enrolled_student(course_id, auth.uid()));

CREATE TRIGGER trg_assignments_updated
BEFORE UPDATE ON public.assignments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.assignment_submissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id UUID NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT,
  file_path TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  score NUMERIC,
  feedback TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','graded','late')),
  graded_by UUID REFERENCES auth.users(id),
  graded_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, student_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignment_submissions TO authenticated;
GRANT ALL ON public.assignment_submissions TO service_role;
ALTER TABLE public.assignment_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students manage own submissions" ON public.assignment_submissions
  FOR ALL TO authenticated
  USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

CREATE POLICY "Instructors grade submissions in own courses" ON public.assignment_submissions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.assignments a
    WHERE a.id = assignment_submissions.assignment_id
      AND public.is_course_instructor(a.course_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.assignments a
    WHERE a.id = assignment_submissions.assignment_id
      AND public.is_course_instructor(a.course_id, auth.uid())));

CREATE TRIGGER trg_submissions_updated
BEFORE UPDATE ON public.assignment_submissions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.notify_on_submission_graded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_title text; v_code text; v_max numeric;
BEGIN
  IF NEW.score IS NULL OR OLD.score IS NOT DISTINCT FROM NEW.score THEN RETURN NEW; END IF;

  SELECT a.title, a.max_score, c.code INTO v_title, v_max, v_code
  FROM public.assignments a JOIN public.courses c ON c.id = a.course_id
  WHERE a.id = NEW.assignment_id;

  INSERT INTO public.notifications (user_id, type, title, body, related_id, action_required, status)
  VALUES (NEW.student_id, 'assignment_graded', 'งานได้รับการตรวจแล้ว',
    COALESCE(v_code,'') || ' — ' || COALESCE(v_title,'งาน') || ': ' ||
    NEW.score::text || '/' || COALESCE(v_max,100)::text ||
    COALESCE(' — ' || NULLIF(NEW.feedback,''), ''),
    NEW.assignment_id, false, 'unread');
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_on_submission_graded() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_notify_submission_graded
AFTER UPDATE ON public.assignment_submissions
FOR EACH ROW EXECUTE FUNCTION public.notify_on_submission_graded();

ALTER PUBLICATION supabase_realtime ADD TABLE public.assignment_submissions;