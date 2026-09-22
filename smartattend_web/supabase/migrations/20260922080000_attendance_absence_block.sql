-- 4-absence auto-block rule, extending the existing class_sessions/
-- attendance_records/course_enrollments tables (no parallel attendance
-- schema) plus warning/block notifications and manual excuse support.

-- 1. Track absence count + block state per enrollment. Kept as columns
--    (recomputed by the trigger below) rather than a live aggregate query
--    everywhere they're needed, including from the Pi over a lightweight
--    REST filter.
ALTER TABLE public.course_enrollments
  ADD COLUMN absent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN attendance_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN attendance_blocked_at timestamptz;

-- 2. Recompute on every attendance_records change and fire warning (1-3)
--    / block (4+) notifications when the count crosses a new threshold.
--    A manual override that brings the count back below 4 (e.g. an
--    instructor excusing a record) un-blocks automatically.
CREATE OR REPLACE FUNCTION public.recompute_attendance_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id uuid;
  v_student_id uuid;
  v_count int;
  v_prev_count int;
  v_was_blocked boolean;
  v_code text;
BEGIN
  SELECT cs.course_id INTO v_course_id
  FROM public.class_sessions cs WHERE cs.id = COALESCE(NEW.session_id, OLD.session_id);
  v_student_id := COALESCE(NEW.student_id, OLD.student_id);
  IF v_course_id IS NULL OR v_student_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT count(*) INTO v_count
  FROM public.attendance_records ar
  JOIN public.class_sessions cs ON cs.id = ar.session_id
  WHERE cs.course_id = v_course_id AND ar.student_id = v_student_id AND ar.status = 'absent';

  SELECT absent_count, attendance_blocked INTO v_prev_count, v_was_blocked
  FROM public.course_enrollments
  WHERE course_id = v_course_id AND student_id = v_student_id;

  IF v_prev_count IS NULL THEN RETURN COALESCE(NEW, OLD); END IF; -- not an enrolled student

  UPDATE public.course_enrollments
    SET absent_count = v_count,
        attendance_blocked = (v_count >= 4),
        attendance_blocked_at = CASE
          WHEN v_count >= 4 AND NOT v_was_blocked THEN now()
          WHEN v_count < 4 THEN NULL
          ELSE attendance_blocked_at
        END
    WHERE course_id = v_course_id AND student_id = v_student_id;

  IF v_count > v_prev_count THEN
    SELECT code INTO v_code FROM public.courses WHERE id = v_course_id;
    IF v_count >= 4 AND NOT v_was_blocked THEN
      INSERT INTO public.notifications (user_id, type, title, body, related_id, action_required, status)
      VALUES (v_student_id, 'attendance_blocked', 'ขาดเรียนครบ 4 ครั้ง — ถูกระงับสิทธิ์',
        'วิชา ' || COALESCE(v_code,'') || ' คุณขาดเรียนครบ 4 ครั้งแล้ว ระบบระงับสิทธิ์สแกนใบหน้าเช็คชื่อ และอาจหมดสิทธิ์สอบตามระเบียบ กรุณาติดต่ออาจารย์ผู้สอนโดยด่วน',
        v_course_id, true, 'unread');
    ELSIF v_count IN (1, 2, 3) THEN
      INSERT INTO public.notifications (user_id, type, title, body, related_id, action_required, status)
      VALUES (v_student_id, 'attendance_warning', 'แจ้งเตือนการขาดเรียน',
        'วิชา ' || COALESCE(v_code,'') || ' คุณขาดเรียนแล้ว ' || v_count || ' ครั้ง — ขาดครบ 4 ครั้งจะถูกระงับสิทธิ์สแกนใบหน้าเช็คชื่อ',
        v_course_id, false, 'unread');
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_attendance_block ON public.attendance_records;
CREATE TRIGGER trg_recompute_attendance_block
AFTER INSERT OR UPDATE OF status OR DELETE ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.recompute_attendance_block();
