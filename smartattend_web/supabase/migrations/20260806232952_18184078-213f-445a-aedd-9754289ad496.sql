-- ============ LEAVE REQUESTS ============
CREATE TABLE public.leave_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.class_sessions(id) ON DELETE SET NULL,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('sick','personal','activity')),
  leave_date DATE NOT NULL,
  reason TEXT NOT NULL,
  attachment_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_requests TO authenticated;
GRANT ALL ON public.leave_requests TO service_role;

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students manage own leave requests" ON public.leave_requests
  FOR ALL TO authenticated
  USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

CREATE POLICY "Instructors review leave requests" ON public.leave_requests
  FOR ALL TO authenticated
  USING (public.is_course_instructor(course_id, auth.uid()))
  WITH CHECK (public.is_course_instructor(course_id, auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.leave_requests;

-- allow 'excused' attendance status
ALTER TABLE public.attendance_records DROP CONSTRAINT IF EXISTS attendance_records_status_check;
ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_records_status_check
  CHECK (status IN ('on_time','late','absent','excused'));

-- notify instructor when a student submits a leave request
CREATE OR REPLACE FUNCTION public.notify_on_leave_submit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_instructor uuid;
  v_code text;
  v_name text;
BEGIN
  SELECT c.instructor_id, c.code INTO v_instructor, v_code
  FROM public.courses c WHERE c.id = NEW.course_id;
  IF v_instructor IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO v_name FROM public.profiles WHERE user_id = NEW.student_id;

  INSERT INTO public.notifications (user_id, type, title, body, related_id, action_required, status)
  VALUES (
    v_instructor, 'leave_submitted', 'มีใบลารออนุมัติ',
    COALESCE(v_name,'นักศึกษา') || ' ยื่นใบลาวิชา ' || COALESCE(v_code,'') ||
    ' วันที่ ' || to_char(NEW.leave_date, 'DD/MM/YYYY'),
    NEW.id, true, 'unread'
  );
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_on_leave_submit() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_notify_leave_submit
AFTER INSERT ON public.leave_requests
FOR EACH ROW EXECUTE FUNCTION public.notify_on_leave_submit();

-- notify student on review + mark attendance excused
CREATE OR REPLACE FUNCTION public.on_leave_reviewed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_code text;
  v_label text;
  v_session uuid;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved','rejected') THEN RETURN NEW; END IF;

  SELECT c.code INTO v_code FROM public.courses c WHERE c.id = NEW.course_id;
  v_label := CASE WHEN NEW.status = 'approved' THEN 'อนุมัติ' ELSE 'ไม่อนุมัติ' END;

  INSERT INTO public.notifications (user_id, type, title, body, related_id, action_required, status)
  VALUES (
    NEW.student_id, 'leave_reviewed', 'ผลการพิจารณาใบลา',
    'ใบลาวิชา ' || COALESCE(v_code,'') || ' วันที่ ' || to_char(NEW.leave_date,'DD/MM/YYYY') ||
    ' ได้รับการ' || v_label || COALESCE(' — ' || NULLIF(NEW.review_note,''), ''),
    NEW.id, false, 'unread'
  );

  IF NEW.status = 'approved' THEN
    v_session := NEW.session_id;
    IF v_session IS NULL THEN
      SELECT cs.id INTO v_session FROM public.class_sessions cs
      WHERE cs.course_id = NEW.course_id
        AND (cs.started_at AT TIME ZONE 'Asia/Bangkok')::date = NEW.leave_date
      LIMIT 1;
    END IF;

    IF v_session IS NOT NULL THEN
      UPDATE public.attendance_records
        SET status = 'excused'
        WHERE session_id = v_session AND student_id = NEW.student_id AND status = 'absent';
      IF NOT FOUND THEN
        INSERT INTO public.attendance_records (session_id, student_id, status)
        VALUES (v_session, NEW.student_id, 'excused')
        ON CONFLICT (session_id, student_id) DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.on_leave_reviewed() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_on_leave_reviewed
AFTER UPDATE ON public.leave_requests
FOR EACH ROW EXECUTE FUNCTION public.on_leave_reviewed();

-- ============ GRADES ============
CREATE TABLE public.grade_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('attendance','assignment','midterm','final','other')),
  max_score NUMERIC NOT NULL DEFAULT 100,
  weight NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.grade_items TO authenticated;
GRANT ALL ON public.grade_items TO service_role;
ALTER TABLE public.grade_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Instructors manage own course grade items" ON public.grade_items
  FOR ALL TO authenticated
  USING (public.is_course_instructor(course_id, auth.uid()))
  WITH CHECK (public.is_course_instructor(course_id, auth.uid()));

CREATE POLICY "Enrolled students view grade items" ON public.grade_items
  FOR SELECT TO authenticated
  USING (public.is_enrolled_student(course_id, auth.uid()));

CREATE TABLE public.student_grades (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  grade_item_id UUID NOT NULL REFERENCES public.grade_items(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score NUMERIC,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (grade_item_id, student_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_grades TO authenticated;
GRANT ALL ON public.student_grades TO service_role;
ALTER TABLE public.student_grades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Instructors manage grades of own courses" ON public.student_grades
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.grade_items gi
    WHERE gi.id = student_grades.grade_item_id
      AND public.is_course_instructor(gi.course_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.grade_items gi
    WHERE gi.id = student_grades.grade_item_id
      AND public.is_course_instructor(gi.course_id, auth.uid())));

CREATE POLICY "Students view own grades" ON public.student_grades
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

CREATE TRIGGER trg_student_grades_updated
BEFORE UPDATE ON public.student_grades
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- notify student when a grade is posted/updated
CREATE OR REPLACE FUNCTION public.notify_on_grade_posted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item text; v_code text; v_max numeric;
BEGIN
  IF NEW.score IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.score IS NOT DISTINCT FROM NEW.score THEN RETURN NEW; END IF;

  SELECT gi.name, gi.max_score, c.code INTO v_item, v_max, v_code
  FROM public.grade_items gi JOIN public.courses c ON c.id = gi.course_id
  WHERE gi.id = NEW.grade_item_id;

  INSERT INTO public.notifications (user_id, type, title, body, related_id, action_required, status)
  VALUES (NEW.student_id, 'grade_posted', 'ประกาศคะแนนใหม่',
    COALESCE(v_code,'') || ' — ' || COALESCE(v_item,'คะแนน') || ': ' ||
    NEW.score::text || '/' || COALESCE(v_max,100)::text,
    NEW.grade_item_id, false, 'unread');
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_on_grade_posted() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_notify_grade_posted
AFTER INSERT OR UPDATE ON public.student_grades
FOR EACH ROW EXECUTE FUNCTION public.notify_on_grade_posted();