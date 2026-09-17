ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS edited_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edit_reason text;

DROP POLICY IF EXISTS "Instructors update own session attendance" ON public.attendance_records;
CREATE POLICY "Instructors update own session attendance"
ON public.attendance_records FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.class_sessions cs WHERE cs.id = attendance_records.session_id AND cs.instructor_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.class_sessions cs WHERE cs.id = attendance_records.session_id AND cs.instructor_id = auth.uid()));

DROP POLICY IF EXISTS "Instructors delete own session attendance" ON public.attendance_records;
CREATE POLICY "Instructors delete own session attendance"
ON public.attendance_records FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.class_sessions cs WHERE cs.id = attendance_records.session_id AND cs.instructor_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_records TO authenticated;
GRANT ALL ON public.attendance_records TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

CREATE OR REPLACE FUNCTION public.notify_instructor_on_checkin()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_instructor uuid;
  v_course_code text;
  v_student_name text;
  v_status_label text;
BEGIN
  IF NEW.status = 'absent' THEN RETURN NEW; END IF;

  SELECT cs.instructor_id, c.code INTO v_instructor, v_course_code
  FROM public.class_sessions cs
  JOIN public.courses c ON c.id = cs.course_id
  WHERE cs.id = NEW.session_id;

  IF v_instructor IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO v_student_name FROM public.profiles WHERE user_id = NEW.student_id;

  v_status_label := CASE WHEN NEW.status = 'late' THEN 'มาสาย' ELSE 'ตรงเวลา' END;

  INSERT INTO public.notifications (user_id, type, title, body, related_id, action_required, status)
  VALUES (
    v_instructor,
    'student_checked_in',
    'มีนักศึกษาเช็คชื่อแล้ว',
    COALESCE(v_student_name, 'นักศึกษา') || ' เช็คชื่อเข้าเรียนวิชา ' || COALESCE(v_course_code,'') ||
    ' เมื่อเวลา ' || to_char(COALESCE(NEW.checked_in_at, now()) AT TIME ZONE 'Asia/Bangkok', 'HH24:MI:SS น.') ||
    ' (' || v_status_label || ')',
    NEW.session_id, false, 'unread'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_instructor_checkin ON public.attendance_records;
CREATE TRIGGER trg_notify_instructor_checkin
AFTER INSERT ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.notify_instructor_on_checkin();

CREATE OR REPLACE VIEW public.v_attendance_summary
WITH (security_invoker = true) AS
SELECT
  ar.student_id,
  cs.course_id,
  c.code  AS course_code,
  c.name  AS course_name,
  COUNT(*) FILTER (WHERE ar.status = 'on_time') AS on_time_count,
  COUNT(*) FILTER (WHERE ar.status = 'late')    AS late_count,
  COUNT(*) FILTER (WHERE ar.status = 'absent')  AS absent_count,
  COUNT(*) AS total_sessions,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ar.status IN ('on_time','late')) / NULLIF(COUNT(*),0), 1) AS attendance_rate
FROM public.attendance_records ar
JOIN public.class_sessions cs ON cs.id = ar.session_id
JOIN public.courses c ON c.id = cs.course_id
GROUP BY ar.student_id, cs.course_id, c.code, c.name;

GRANT SELECT ON public.v_attendance_summary TO authenticated;

ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.attendance_records REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_records;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;