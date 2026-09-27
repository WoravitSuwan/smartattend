-- ═══════════════════════════════════════════════════════════════════════════
--  เฟส 5 การประกาศผลและเกรด
--    5.1 เกรดพิเศษ I / W และ F ที่มาจากการขาดเรียน (แยกจาก F ที่คะแนนไม่ถึง)
--    5.2 ตรวจความครบก่อนประกาศ
--    5.3 ล็อกคะแนนหลังประกาศ ปลดล็อกต้องมีเหตุผลและแจ้งนักศึกษา
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. เกรดที่ประกาศจริง เก็บแยกจากคะแนน เพราะเป็นสิ่งที่ส่งระบบทะเบียน
--    และต้องบอกได้ว่า F ตัวนี้มาจากอะไร
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.course_final_grades (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grade         text NOT NULL,
  /** ที่มาของเกรด — ในใบส่งเกรด F สองแบบมีความหมายต่างกัน */
  grade_source  text NOT NULL DEFAULT 'computed'
                CHECK (grade_source IN (
                  'computed',          -- คิดจากคะแนนตามเกณฑ์ตัดเกรด
                  'incomplete',        -- I ผลการเรียนไม่สมบูรณ์
                  'withdrawn',         -- W ถอนรายวิชา
                  'absence_blocked',   -- F เพราะขาดเรียนเกินเกณฑ์ ไม่ใช่เพราะคะแนนไม่ถึง
                  'manual')),          -- อาจารย์กำหนดเอง
  score         numeric,               -- ร้อยละที่ใช้ตัดเกรด (NULL สำหรับ I/W)
  reason        text,
  published_at  timestamptz NOT NULL DEFAULT now(),
  published_by  uuid,
  UNIQUE (course_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_course_final_grades_course
  ON public.course_final_grades(course_id);

ALTER TABLE public.course_final_grades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students view own final grade" ON public.course_final_grades;
CREATE POLICY "Students view own final grade" ON public.course_final_grades
  FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    -- เห็นได้เฉพาะเมื่อประกาศผลแล้ว ปิดที่ระดับฐานข้อมูลเหมือนคะแนนปลายภาค
    AND EXISTS (SELECT 1 FROM public.courses c
                 WHERE c.id = course_final_grades.course_id AND c.final_grade_published)
  );

DROP POLICY IF EXISTS "Instructors manage course final grades" ON public.course_final_grades;
CREATE POLICY "Instructors manage course final grades" ON public.course_final_grades
  FOR ALL TO authenticated
  USING (public.is_course_instructor(course_id, auth.uid())
         OR internal.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.is_course_instructor(course_id, auth.uid())
         OR internal.has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT ON public.course_final_grades TO authenticated;
GRANT ALL ON public.course_final_grades TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. ล็อกคะแนนหลังประกาศ
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS grades_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS grades_unlocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS grades_unlock_reason text;

COMMENT ON COLUMN public.courses.grades_locked IS
  'true = ประกาศผลแล้วและคะแนนถูกล็อก ต้องปลดล็อกพร้อมระบุเหตุผลก่อนแก้';

/** ถูกล็อกอยู่หรือไม่ — ใช้ใน RPC ที่เขียนคะแนน */
CREATE OR REPLACE FUNCTION public.course_grades_locked(_course_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(grades_locked, false) FROM public.courses WHERE id = _course_id;
$$;

GRANT EXECUTE ON FUNCTION public.course_grades_locked(uuid) TO authenticated;

/** ปลดล็อกเพื่อแก้คะแนนหลังประกาศ — ต้องระบุเหตุผล และบันทึกทุกครั้ง */
CREATE OR REPLACE FUNCTION public.unlock_course_grades(
  _course_id uuid,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ปลดล็อกคะแนนของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF btrim(COALESCE(_reason, '')) = '' THEN
    RAISE EXCEPTION 'การปลดล็อกคะแนนต้องระบุเหตุผล' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.courses
     SET grades_locked = false,
         grades_unlocked_at = now(),
         grades_unlock_reason = btrim(_reason)
   WHERE id = _course_id;

  PERFORM public.log_audit_event(
    'grade.unlock', 'course', _course_id::text,
    'ปลดล็อกคะแนนหลังประกาศผล เพื่อแก้ไข',
    NULL::jsonb, NULL::jsonb, btrim(_reason));
END;
$$;

REVOKE ALL ON FUNCTION public.unlock_course_grades(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unlock_course_grades(uuid, text) TO authenticated;

/** ล็อกกลับหลังแก้เสร็จ และแจ้งนักศึกษาที่คะแนนเปลี่ยน */
CREATE OR REPLACE FUNCTION public.relock_course_grades(_course_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed integer := 0;
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ล็อกคะแนนของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- แจ้งเฉพาะคนที่มีการแก้คะแนนหลังการปลดล็อกครั้งล่าสุด
  INSERT INTO public.notifications
    (user_id, type, title, body, related_id, action_required, status)
  SELECT DISTINCT sg.student_id, 'grade_posted', 'คะแนนของคุณถูกแก้ไข',
    'วิชา ' || c.code || ' มีการแก้ไขคะแนนหลังประกาศผล กรุณาตรวจสอบที่หน้าคะแนนเก็บ',
    _course_id, false, 'unread'
  FROM public.grade_audit_logs gal
  JOIN public.student_grades sg ON sg.id = gal.student_grade_id
  JOIN public.grade_items gi ON gi.id = sg.grade_item_id
  JOIN public.courses c ON c.id = gi.course_id
  WHERE gi.course_id = _course_id
    AND c.grades_unlocked_at IS NOT NULL
    AND gal.created_at >= c.grades_unlocked_at;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  UPDATE public.courses SET grades_locked = true WHERE id = _course_id;

  PERFORM public.log_audit_event(
    'grade.lock', 'course', _course_id::text,
    'ล็อกคะแนนกลับหลังแก้ไข · แจ้งนักศึกษาที่คะแนนเปลี่ยน ' || v_changed::text || ' คน',
    NULL::jsonb, NULL::jsonb, NULL::text);

  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.relock_course_grades(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relock_course_grades(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. ตรวจความครบก่อนประกาศ (5.2)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.publish_readiness(_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_weight numeric;
  v_blanks jsonb := '[]'::jsonb;
  v_blank_count integer := 0;
  v_suggest jsonb := '[]'::jsonb;
  rec record;
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูข้อมูลของรายวิชานี้' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(sum(weight_percent), 0) INTO v_total_weight
  FROM public.grade_components WHERE course_id = _course_id;

  -- ช่องว่าง: นักศึกษาคนไหน หมวดไหน รายการไหน (จำกัด 50 รายการแรกพอให้เห็นภาพ)
  FOR rec IN
    SELECT p.name AS student_name, COALESCE(p.student_code,'-') AS student_code,
           gc.name AS component_name, gi.name AS item_name
    FROM public.course_enrollments ce
    JOIN public.profiles p ON p.user_id = ce.student_id
    JOIN public.grade_items gi ON gi.course_id = _course_id
    LEFT JOIN public.grade_components gc ON gc.id = gi.component_id
    LEFT JOIN public.student_grades sg
           ON sg.grade_item_id = gi.id AND sg.student_id = ce.student_id
    WHERE ce.course_id = _course_id AND ce.status = 'confirmed'
      AND ce.student_id IS NOT NULL AND ce.withdrawn_at IS NULL
      AND gi.max_score > 0
      AND sg.score IS NULL
    ORDER BY p.student_code NULLS LAST, gc.position, gi.position
    LIMIT 50
  LOOP
    v_blanks := v_blanks || jsonb_build_object(
      'student_name', rec.student_name, 'student_code', rec.student_code,
      'component', COALESCE(rec.component_name, '(ไม่มีหมวด)'), 'item', rec.item_name);
  END LOOP;

  SELECT count(*) INTO v_blank_count
  FROM public.course_enrollments ce
  JOIN public.grade_items gi ON gi.course_id = _course_id
  LEFT JOIN public.student_grades sg
         ON sg.grade_item_id = gi.id AND sg.student_id = ce.student_id
  WHERE ce.course_id = _course_id AND ce.status = 'confirmed'
    AND ce.student_id IS NOT NULL AND ce.withdrawn_at IS NULL
    AND gi.max_score > 0 AND sg.score IS NULL;

  -- นักศึกษาที่ควรได้ I หรือ W
  FOR rec IN
    SELECT ce.student_id, COALESCE(p.name,'นักศึกษา') AS name,
           COALESCE(p.student_code,'-') AS code,
           ce.withdrawn_at, ce.attendance_blocked,
           (SELECT count(*) FROM public.grade_items gi2
             LEFT JOIN public.student_grades sg2
                    ON sg2.grade_item_id = gi2.id AND sg2.student_id = ce.student_id
             WHERE gi2.course_id = _course_id AND gi2.max_score > 0 AND sg2.score IS NULL
           ) AS missing
    FROM public.course_enrollments ce
    LEFT JOIN public.profiles p ON p.user_id = ce.student_id
    WHERE ce.course_id = _course_id AND ce.status = 'confirmed' AND ce.student_id IS NOT NULL
  LOOP
    IF rec.withdrawn_at IS NOT NULL THEN
      v_suggest := v_suggest || jsonb_build_object(
        'student_id', rec.student_id, 'name', rec.name, 'code', rec.code,
        'grade', 'W', 'source', 'withdrawn',
        'why', 'ถอนรายวิชาเมื่อ ' || to_char(rec.withdrawn_at AT TIME ZONE 'Asia/Bangkok','DD/MM/YYYY'));
    ELSIF rec.attendance_blocked THEN
      v_suggest := v_suggest || jsonb_build_object(
        'student_id', rec.student_id, 'name', rec.name, 'code', rec.code,
        'grade', 'F', 'source', 'absence_blocked',
        'why', 'ถูกระงับสิทธิ์จากการขาดเรียนเกินเกณฑ์ (F นี้คนละความหมายกับ F ที่คะแนนไม่ถึง)');
    ELSIF rec.missing > 0 THEN
      v_suggest := v_suggest || jsonb_build_object(
        'student_id', rec.student_id, 'name', rec.name, 'code', rec.code,
        'grade', 'I', 'source', 'incomplete',
        'why', 'ยังมีคะแนนว่าง ' || rec.missing::text || ' รายการ');
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'total_weight', round(v_total_weight, 2),
    'weight_ok', round(v_total_weight, 2) = 100,
    'blank_count', v_blank_count,
    'blanks', v_blanks,
    'blanks_truncated', v_blank_count > 50,
    'suggested_special', v_suggest,
    'ready', round(v_total_weight, 2) = 100 AND v_blank_count = 0);
END;
$$;

REVOKE ALL ON FUNCTION public.publish_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_readiness(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. ประกาศผล (แทนตัวเดิม) — เขียนเกรดลง course_final_grades และล็อกคะแนน
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.publish_final_grades(
  _course_id uuid,
  _force boolean DEFAULT false,
  _reason text DEFAULT NULL,
  _special jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ready jsonb;
  rec record;
  sp jsonb;
  v_summary jsonb;
  v_grade text;
  v_source text;
  v_score numeric;
  v_written integer := 0;
  v_special_count integer := 0;
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ประกาศผลของรายวิชานี้' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_ready := public.publish_readiness(_course_id);

  IF NOT (v_ready->>'weight_ok')::boolean THEN
    RAISE EXCEPTION 'น้ำหนักคะแนนรวมต้องเท่ากับ 100 พอดีก่อนประกาศผล (ขณะนี้ %)',
      v_ready->>'total_weight' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (v_ready->>'ready')::boolean AND NOT _force THEN
    RAISE EXCEPTION 'ยังมีคะแนนว่าง % ช่อง ประกาศผลไม่ได้ ถ้าต้องการประกาศทั้งที่ยังไม่ครบ ต้องยืนยันพร้อมระบุเหตุผล',
      v_ready->>'blank_count' USING ERRCODE = 'check_violation';
  END IF;

  IF _force AND btrim(COALESCE(_reason, '')) = '' THEN
    RAISE EXCEPTION 'การประกาศผลทั้งที่คะแนนยังไม่ครบ ต้องระบุเหตุผล'
      USING ERRCODE = 'check_violation';
  END IF;

  -- เกรดพิเศษที่อาจารย์กำหนดมา (I / W / F จากการขาดเรียน)
  FOR sp IN SELECT * FROM jsonb_array_elements(COALESCE(_special, '[]'::jsonb)) LOOP
    INSERT INTO public.course_final_grades
      (course_id, student_id, grade, grade_source, score, reason, published_by)
    VALUES (_course_id, (sp->>'student_id')::uuid, sp->>'grade',
            COALESCE(sp->>'source', 'manual'), NULL, sp->>'reason', auth.uid())
    ON CONFLICT (course_id, student_id) DO UPDATE
      SET grade = EXCLUDED.grade, grade_source = EXCLUDED.grade_source,
          score = NULL, reason = EXCLUDED.reason,
          published_at = now(), published_by = auth.uid();
    v_special_count := v_special_count + 1;
  END LOOP;

  -- ที่เหลือคิดจากคะแนน
  FOR rec IN
    SELECT ce.student_id, ce.withdrawn_at, ce.attendance_blocked
    FROM public.course_enrollments ce
    WHERE ce.course_id = _course_id AND ce.status = 'confirmed' AND ce.student_id IS NOT NULL
  LOOP
    -- ข้ามคนที่ถูกกำหนดเกรดพิเศษมาแล้วในรอบนี้
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(_special,'[]'::jsonb)) e
                WHERE (e->>'student_id')::uuid = rec.student_id) THEN
      CONTINUE;
    END IF;

    IF rec.withdrawn_at IS NOT NULL THEN
      v_grade := 'W'; v_source := 'withdrawn'; v_score := NULL;
    ELSIF rec.attendance_blocked THEN
      -- F เพราะขาดเรียน ต้องแยกจาก F ที่คะแนนไม่ถึง เพราะในใบส่งเกรดคนละความหมาย
      v_grade := 'F'; v_source := 'absence_blocked'; v_score := NULL;
    ELSE
      v_summary := public.get_student_score_summary(_course_id, rec.student_id);
      v_score := (v_summary->>'normalized')::numeric;
      IF v_score IS NULL THEN
        v_grade := 'I'; v_source := 'incomplete';
      ELSE
        v_grade := public.grade_letter(_course_id, v_score);
        v_source := 'computed';
      END IF;
    END IF;

    INSERT INTO public.course_final_grades
      (course_id, student_id, grade, grade_source, score, reason, published_by)
    VALUES (_course_id, rec.student_id, v_grade, v_source, round(v_score, 2),
            CASE WHEN v_source = 'absence_blocked'
                 THEN 'ระงับสิทธิ์จากการขาดเรียนเกินเกณฑ์'
                 WHEN v_source = 'withdrawn' THEN 'ถอนรายวิชา'
                 WHEN v_source = 'incomplete' THEN 'คะแนนยังไม่ครบ'
                 ELSE NULL END,
            auth.uid())
    ON CONFLICT (course_id, student_id) DO UPDATE
      SET grade = EXCLUDED.grade, grade_source = EXCLUDED.grade_source,
          score = EXCLUDED.score, reason = EXCLUDED.reason,
          published_at = now(), published_by = auth.uid();
    v_written := v_written + 1;
  END LOOP;

  UPDATE public.courses
     SET final_grade_published = true, grades_locked = true
   WHERE id = _course_id;

  INSERT INTO public.notifications
    (user_id, type, title, body, related_id, action_required, status)
  SELECT ce.student_id, 'grade_posted', 'ประกาศผลการเรียนแล้ว',
    'วิชา ' || c.code || ' ประกาศผลการเรียนแล้ว เข้าไปดูได้ที่หน้าคะแนนเก็บ',
    _course_id, false, 'unread'
  FROM public.course_enrollments ce
  JOIN public.courses c ON c.id = _course_id
  WHERE ce.course_id = _course_id AND ce.status = 'confirmed' AND ce.student_id IS NOT NULL;

  PERFORM public.log_audit_event(
    'grade.announce', 'course', _course_id::text,
    'ประกาศผลการเรียน ' || v_written::text || ' คน · เกรดพิเศษ ' || v_special_count::text
      || ' คน · น้ำหนักรวม ' || (v_ready->>'total_weight')
      || CASE WHEN _force THEN ' · ประกาศทั้งที่ยังมีคะแนนว่าง ' || (v_ready->>'blank_count') || ' ช่อง'
              ELSE '' END,
    NULL::jsonb, v_ready, _reason);

  RETURN jsonb_build_object('published', v_written, 'special', v_special_count,
                            'readiness', v_ready, 'locked', true);
END;
$$;

DROP FUNCTION IF EXISTS public.publish_final_grades(uuid);
REVOKE ALL ON FUNCTION public.publish_final_grades(uuid, boolean, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_final_grades(uuid, boolean, text, jsonb) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. บังคับการล็อกใน RPC ที่เขียนคะแนนทุกตัว (5.3)
--    ถ้าบังคับแค่ที่หน้าจอ ยิง REST ตรงก็แก้คะแนนหลังประกาศได้
-- ───────────────────────────────────────────────────────────────────────────
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
  _max_score numeric;
  _item_name text;
  _row_id uuid;
  _old_score numeric;
BEGIN
  SELECT course_id, max_score, name
    INTO _course_id, _max_score, _item_name
  FROM public.grade_items WHERE id = _grade_item_id;
  IF _course_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบหัวข้อคะแนนนี้ (อาจถูกลบไปแล้ว)' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้คะแนนของรายวิชานี้' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.course_grades_locked(_course_id) THEN
    RAISE EXCEPTION 'รายวิชานี้ประกาศผลแล้วและคะแนนถูกล็อก ต้องปลดล็อกพร้อมระบุเหตุผลก่อนแก้'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _score IS NOT NULL THEN
    IF _score = 'NaN'::numeric THEN
      RAISE EXCEPTION 'คะแนนของหัวข้อ "%" ไม่ใช่ตัวเลข', _item_name
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF _score < 0 THEN
      RAISE EXCEPTION 'คะแนนติดลบไม่ได้ — หัวข้อ "%" ได้รับค่า %', _item_name, _score
        USING ERRCODE = 'check_violation';
    END IF;
    IF _max_score IS NULL OR _max_score <= 0 THEN
      RAISE EXCEPTION 'หัวข้อ "%" ยังตั้งคะแนนเต็มไม่ถูกต้อง (ปัจจุบัน %) กรุณาแก้คะแนนเต็มก่อนกรอกคะแนน',
        _item_name, COALESCE(_max_score::text, 'ว่าง') USING ERRCODE = 'check_violation';
    END IF;
    IF _score > _max_score THEN
      RAISE EXCEPTION 'คะแนนเกินคะแนนเต็ม — หัวข้อ "%" เต็ม % แต่ได้รับ %',
        _item_name, _max_score, _score USING ERRCODE = 'check_violation';
    END IF;
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
    INSERT INTO public.grade_audit_logs
      (student_grade_id, modified_by, previous_score, new_score, reason)
    VALUES (_row_id, auth.uid(), _old_score, _score, _reason);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_student_grade(uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_student_grade(uuid, uuid, numeric, text, text) TO authenticated;

-- save_student_grades ก็ต้องตรวจการล็อกด้วย ใส่ไว้ตรงหลังตรวจสิทธิ์
CREATE OR REPLACE FUNCTION public.save_student_grades(
  _course_id uuid,
  _changes jsonb,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c jsonb;
  _errors jsonb := '[]'::jsonb;
  _saved integer := 0;
  _item record;
  _score numeric;
  _row_id uuid;
  _old_score numeric;
  _published boolean;
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้คะแนนของรายวิชานี้' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.course_grades_locked(_course_id) THEN
    RAISE EXCEPTION 'รายวิชานี้ประกาศผลแล้วและคะแนนถูกล็อก ต้องปลดล็อกพร้อมระบุเหตุผลก่อนแก้'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _changes IS NULL OR jsonb_typeof(_changes) <> 'array' THEN
    RAISE EXCEPTION 'รูปแบบข้อมูลคะแนนไม่ถูกต้อง' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF jsonb_array_length(_changes) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'saved', 0, 'errors', '[]'::jsonb);
  END IF;

  SELECT final_grade_published INTO _published FROM public.courses WHERE id = _course_id;

  FOR c IN SELECT * FROM jsonb_array_elements(_changes) LOOP
    _item := NULL;
    SELECT gi.id, gi.name, gi.max_score, gi.course_id INTO _item
    FROM public.grade_items gi WHERE gi.id = (c->>'grade_item_id')::uuid;

    IF _item.id IS NULL THEN
      _errors := _errors || jsonb_build_object(
        'grade_item_id', c->>'grade_item_id', 'student_id', c->>'student_id',
        'reason', 'ไม่พบหัวข้อคะแนนนี้ (อาจถูกลบไปแล้ว)');
      CONTINUE;
    END IF;
    IF _item.course_id <> _course_id THEN
      _errors := _errors || jsonb_build_object(
        'grade_item_id', c->>'grade_item_id', 'student_id', c->>'student_id',
        'reason', 'หัวข้อคะแนนนี้ไม่ได้อยู่ในรายวิชานี้');
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.course_enrollments ce
      WHERE ce.course_id = _course_id AND ce.student_id = (c->>'student_id')::uuid
        AND ce.status = 'confirmed'
    ) THEN
      _errors := _errors || jsonb_build_object(
        'grade_item_id', _item.id, 'student_id', c->>'student_id',
        'reason', 'นักศึกษาคนนี้ไม่ได้ลงทะเบียนรายวิชานี้');
      CONTINUE;
    END IF;

    IF (c->'score') IS NULL OR jsonb_typeof(c->'score') = 'null' THEN CONTINUE; END IF;
    IF jsonb_typeof(c->'score') <> 'number' THEN
      _errors := _errors || jsonb_build_object(
        'grade_item_id', _item.id, 'student_id', c->>'student_id', 'reason', 'คะแนนไม่ใช่ตัวเลข');
      CONTINUE;
    END IF;

    _score := (c->>'score')::numeric;
    IF _item.max_score IS NULL OR _item.max_score <= 0 THEN
      _errors := _errors || jsonb_build_object(
        'grade_item_id', _item.id, 'student_id', c->>'student_id',
        'reason', 'หัวข้อ "' || _item.name || '" ยังตั้งคะแนนเต็มไม่ถูกต้อง');
    ELSIF _score < 0 THEN
      _errors := _errors || jsonb_build_object(
        'grade_item_id', _item.id, 'student_id', c->>'student_id', 'reason', 'คะแนนติดลบไม่ได้');
    ELSIF _score > _item.max_score THEN
      _errors := _errors || jsonb_build_object(
        'grade_item_id', _item.id, 'student_id', c->>'student_id',
        'reason', 'เกินคะแนนเต็ม (' || _item.max_score::text || ')');
    END IF;
  END LOOP;

  IF jsonb_array_length(_errors) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'saved', 0, 'errors', _errors);
  END IF;

  FOR c IN SELECT * FROM jsonb_array_elements(_changes) LOOP
    _score := CASE WHEN jsonb_typeof(c->'score') = 'number'
                   THEN (c->>'score')::numeric ELSE NULL END;

    SELECT id, score INTO _row_id, _old_score
    FROM public.student_grades
    WHERE grade_item_id = (c->>'grade_item_id')::uuid
      AND student_id = (c->>'student_id')::uuid;

    IF _row_id IS NULL THEN
      INSERT INTO public.student_grades (grade_item_id, student_id, score, note)
      VALUES ((c->>'grade_item_id')::uuid, (c->>'student_id')::uuid, _score, c->>'note')
      RETURNING id INTO _row_id;
      _old_score := NULL;
    ELSE
      UPDATE public.student_grades
         SET score = _score, note = COALESCE(c->>'note', note)
       WHERE id = _row_id;
    END IF;

    IF _old_score IS DISTINCT FROM _score THEN
      INSERT INTO public.grade_audit_logs
        (student_grade_id, modified_by, previous_score, new_score, reason)
      VALUES (_row_id, auth.uid(), _old_score, _score,
              CASE WHEN COALESCE(_published, false)
                   THEN COALESCE(_reason || ' · ', '') || 'แก้ไขหลังประกาศผลแล้ว'
                   ELSE _reason END);
      _saved := _saved + 1;
    END IF;
  END LOOP;

  PERFORM public.log_audit_event(
    'grade.update', 'course', _course_id::text,
    'บันทึกคะแนน ' || _saved::text || ' รายการ'
      || CASE WHEN COALESCE(_published, false) THEN ' (รายวิชาประกาศผลแล้ว)' ELSE '' END,
    NULL::jsonb, NULL::jsonb, _reason);

  RETURN jsonb_build_object('ok', true, 'saved', _saved, 'errors', '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.save_student_grades(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_student_grades(uuid, jsonb, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. เกรดพิเศษต้องมีในเกณฑ์ตัดเกรดด้วย เพื่อให้แสดงผลและส่งออกได้
--    I / W ไม่คิดแต้ม GPA (grade_point = 0) และไม่มี min_score จริง
--    จึงใส่เป็นแถวของระบบที่ min_score = 0 ไม่ได้ ต้องแยกเป็น "เกรดที่ไม่คิดคะแนน"
--    เก็บไว้ที่ course_final_grades.grade_source แทน ไม่ปนกับ grade_scales
--    (grade_scales ใช้ตัดเกรดจากคะแนนเท่านั้น)
-- ───────────────────────────────────────────────────────────────────────────
COMMENT ON TABLE public.course_final_grades IS
  'เกรดที่ประกาศจริงต่อนักศึกษาต่อรายวิชา แยกจากคะแนนเพราะเป็นสิ่งที่ส่งระบบทะเบียน '
  'grade_source บอกที่มา: computed = คิดจากคะแนน, incomplete = I, withdrawn = W, '
  'absence_blocked = F เพราะขาดเรียนเกินเกณฑ์ (คนละความหมายกับ F ที่คะแนนไม่ถึง), '
  'manual = อาจารย์กำหนดเอง';
