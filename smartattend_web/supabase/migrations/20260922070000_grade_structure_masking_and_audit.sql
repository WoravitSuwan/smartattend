-- Extends the existing dynamic grading system (grade_items / student_grades,
-- already a weighted-category structure equivalent to what was asked for)
-- with: a per-course "final grades published" gate that masks the final-exam
-- score from students at the RLS level (not just hidden in the UI), a
-- granular per-score audit trail with a reason, and a publish action.

-- 1. Per-course gate for revealing final-exam scores / final grade.
ALTER TABLE public.courses
  ADD COLUMN final_grade_published boolean NOT NULL DEFAULT false;

-- 2. Granular audit trail for individual score edits.
CREATE TABLE public.grade_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_grade_id uuid NOT NULL REFERENCES public.student_grades(id) ON DELETE CASCADE,
  modified_by uuid NOT NULL,
  previous_score numeric,
  new_score numeric,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.grade_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Instructors and admins view grade audit logs"
ON public.grade_audit_logs FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.student_grades sg
    JOIN public.grade_items gi ON gi.id = sg.grade_item_id
    WHERE sg.id = grade_audit_logs.student_grade_id
      AND (public.is_course_instructor(gi.course_id, auth.uid())
           OR internal.has_role(auth.uid(), 'admin'::app_role))
  )
);

-- 3. Upsert a student's score through one atomic, audited path. The app
--    calls this instead of upserting student_grades directly so every
--    correction is guaranteed a modified_by/old/new/timestamp row, with an
--    optional reason from the instructor.
CREATE OR REPLACE FUNCTION public.upsert_student_grade(
  _grade_item_id uuid,
  _student_id uuid,
  _score numeric,
  _note text DEFAULT NULL,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _course_id uuid;
  _row_id uuid;
  _old_score numeric;
BEGIN
  SELECT course_id INTO _course_id FROM public.grade_items WHERE id = _grade_item_id;
  IF _course_id IS NULL THEN
    RAISE EXCEPTION 'grade_item_not_found';
  END IF;
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT id, score INTO _row_id, _old_score
  FROM public.student_grades
  WHERE grade_item_id = _grade_item_id AND student_id = _student_id;

  IF _row_id IS NULL THEN
    INSERT INTO public.student_grades (grade_item_id, student_id, score, note)
    VALUES (_grade_item_id, _student_id, _score, _note)
    RETURNING id INTO _row_id;
  ELSE
    UPDATE public.student_grades SET score = _score, note = COALESCE(_note, note)
    WHERE id = _row_id;
  END IF;

  IF _old_score IS DISTINCT FROM _score THEN
    INSERT INTO public.grade_audit_logs (student_grade_id, modified_by, previous_score, new_score, reason)
    VALUES (_row_id, auth.uid(), _old_score, _score, _reason);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_student_grade(uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_student_grade(uuid, uuid, numeric, text, text) TO authenticated;

-- 4. Publish final grades for a course — flips the gate and announces it
--    (without leaking any score value) to every confirmed student.
CREATE OR REPLACE FUNCTION public.publish_final_grades(_course_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.courses SET final_grade_published = true WHERE id = _course_id;

  INSERT INTO public.notifications (user_id, type, title, body, related_id, action_required, status)
  SELECT ce.student_id, 'grade_posted', 'ประกาศผลคะแนนปลายภาคแล้ว',
    'วิชา ' || c.code || ' ประกาศผลสอบปลายภาคและเกรดรวมแล้ว เข้าไปดูได้ที่หน้าคะแนนเก็บ',
    _course_id, false, 'unread'
  FROM public.course_enrollments ce
  JOIN public.courses c ON c.id = _course_id
  WHERE ce.course_id = _course_id AND ce.status = 'confirmed' AND ce.student_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_final_grades(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_final_grades(uuid) TO authenticated;

-- 5. Mask final-exam rows from students until published — enforced at the
--    RLS level (the row is simply absent from the response, not just
--    hidden in the UI), so a direct REST call from a student can't read it.
DROP POLICY IF EXISTS "Students view own grades" ON public.student_grades;
CREATE POLICY "Students view own grades" ON public.student_grades
  FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.grade_items gi
      JOIN public.courses c ON c.id = gi.course_id
      WHERE gi.id = student_grades.grade_item_id
        AND gi.category = 'final'
        AND NOT c.final_grade_published
    )
  );

-- 6. The existing "new grade posted" notification would otherwise leak the
--    final-exam score in the notification body before publish — gate it.
CREATE OR REPLACE FUNCTION public.notify_on_grade_posted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item text; v_code text; v_max numeric; v_category text; v_published boolean;
BEGIN
  IF NEW.score IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.score IS NOT DISTINCT FROM NEW.score THEN RETURN NEW; END IF;

  SELECT gi.name, gi.max_score, gi.category, c.code, c.final_grade_published
    INTO v_item, v_max, v_category, v_code, v_published
  FROM public.grade_items gi JOIN public.courses c ON c.id = gi.course_id
  WHERE gi.id = NEW.grade_item_id;

  IF v_category = 'final' AND NOT COALESCE(v_published, false) THEN
    RETURN NEW; -- publish_final_grades() sends its own announcement instead
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, related_id, action_required, status)
  VALUES (NEW.student_id, 'grade_posted', 'ประกาศคะแนนใหม่',
    COALESCE(v_code,'') || ' — ' || COALESCE(v_item,'คะแนน') || ': ' ||
    NEW.score::text || '/' || COALESCE(v_max,100)::text,
    NEW.grade_item_id, false, 'unread');
  RETURN NEW;
END;
$$;
