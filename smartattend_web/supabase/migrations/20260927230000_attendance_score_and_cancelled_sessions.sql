-- ═══════════════════════════════════════════════════════════════════════════
--  เฟส 3 คะแนนการเข้าเรียน
--    3.1 เกณฑ์ที่อาจารย์ตั้งเองรายวิชา (คอลัมน์เพิ่มไปแล้วใน 20260927190000)
--    3.2 จำนวนคาบที่นับ — ไม่นับคาบที่ยกเลิก และนับตามช่วงที่นักศึกษาอยู่ในวิชา
--    3.3 การยกเลิกคาบเรียน
--    3.4 ความโปร่งใส — บอกที่มาของคะแนนทุกตัว
--
--  ปัญหาของเดิม (recalc_attendance_scores ใน 20260926090000)
--    ตัวหารคือ count(*) ของคาบที่ status = 'closed' ทั้งรายวิชา ซึ่งผิดสามทาง
--      1. คาบที่ยกเลิกไม่ถูกแยกออก (สถานะ 'cancelled' มีใน constraint แล้วแต่
--         ไม่มีใครเซ็ต และตัวคำนวณไม่รู้จัก)
--      2. นักศึกษาที่เข้ากลางเทอมถูกนับขาดในคาบก่อนที่ตัวเองจะเข้าร่วม
--      3. นักศึกษาที่ถอนรายวิชายังถูกนับและยังปรากฏในตารางคะแนน
--    และใช้ late_credit/excused_credit เท่านั้น ไม่มี credit_on_time /
--    credit_absent ให้อาจารย์ที่ให้คนมาสายเต็มคะแนนตั้งค่าได้
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. ช่วงเวลาที่นักศึกษาอยู่ในรายวิชา
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.course_enrollments
  ADD COLUMN IF NOT EXISTS joined_at timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;

COMMENT ON COLUMN public.course_enrollments.joined_at IS
  'วันที่เข้าร่วมรายวิชา — คาบที่ปิดก่อนวันนี้ไม่ถูกนับในคะแนนเข้าเรียนของคนนี้ '
  'NULL = นับตั้งแต่คาบแรกของรายวิชา';
COMMENT ON COLUMN public.course_enrollments.withdrawn_at IS
  'วันที่ถอนรายวิชา — คาบที่ปิดหลังวันนี้ไม่ถูกนับ และคนนี้ไม่ปรากฏในตารางคะแนน '
  'NULL = ยังเรียนอยู่';

-- เติม joined_at ให้แถวเดิมที่ยังว่าง เพื่อไม่ให้พฤติกรรมเปลี่ยนไปจากเดิม
-- (NULL อยู่แล้วก็แปลว่านับทุกคาบ ซึ่งตรงกับของเดิม จึงไม่ต้องเติมก็ได้
--  แต่เติมให้ชัดเจนเพื่อให้หน้าจอมีวันที่แสดง)
UPDATE public.course_enrollments ce
   SET joined_at = COALESCE(joined_at, (
         SELECT min(cs.started_at) FROM public.class_sessions cs
          WHERE cs.course_id = ce.course_id))
 WHERE joined_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_course_enrollments_window
  ON public.course_enrollments(course_id, student_id, withdrawn_at);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. การยกเลิกคาบเรียน
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.class_sessions
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS makeup_of_session_id uuid REFERENCES public.class_sessions(id) ON DELETE SET NULL,
  -- คาบที่สอนไปแล้วบางส่วนแล้วยกเลิก: เก็บระเบียนไว้เป็นหลักฐานแต่ไม่นับคะแนน
  ADD COLUMN IF NOT EXISTS counts_for_grade boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.class_sessions.counts_for_grade IS
  'false = ไม่นับคาบนี้ในคะแนนการเข้าเรียน แต่ยังเก็บระเบียนการเช็คชื่อไว้เป็นหลักฐาน '
  'ใช้กับกรณียกเลิกคาบหลังจากมีคนเช็คชื่อไปแล้ว';

/**
 * ยกเลิกคาบเรียน
 *   _records = 'keep'   เก็บระเบียนไว้เป็นหลักฐานแต่ไม่นับคะแนน (สอนไปแล้วบางส่วน)
 *   _records = 'delete' ลบระเบียนทั้งหมด (เปิดคาบผิด)
 * ไม่บันทึกขาดเรียนอัตโนมัติเมื่อยกเลิก — การบันทึกขาดทำเฉพาะตอนปิดคาบตามปกติ
 */
CREATE OR REPLACE FUNCTION public.cancel_class_session(
  _session_id uuid,
  _reason text,
  _records text DEFAULT 'keep',
  _makeup_start timestamptz DEFAULT NULL,
  _makeup_end timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
  v_course record;
  v_removed integer := 0;
  v_notified integer := 0;
  v_makeup uuid;
BEGIN
  SELECT cs.id, cs.course_id, cs.status, cs.started_at, cs.late_after_minutes, cs.instructor_id
    INTO s
  FROM public.class_sessions cs WHERE cs.id = _session_id;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบคาบเรียนนี้' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (public.is_course_instructor(s.course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ยกเลิกคาบเรียนของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF btrim(COALESCE(_reason, '')) = '' THEN
    RAISE EXCEPTION 'การยกเลิกคาบเรียนต้องระบุเหตุผล' USING ERRCODE = 'check_violation';
  END IF;
  IF s.status = 'cancelled' THEN
    RAISE EXCEPTION 'คาบนี้ถูกยกเลิกไปแล้ว' USING ERRCODE = 'check_violation';
  END IF;
  IF _records NOT IN ('keep', 'delete') THEN
    RAISE EXCEPTION 'ต้องเลือกว่าจะเก็บระเบียนการเช็คชื่อไว้หรือลบทิ้ง'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT code, name INTO v_course FROM public.courses WHERE id = s.course_id;

  IF _records = 'delete' THEN
    DELETE FROM public.attendance_records WHERE session_id = _session_id;
    GET DIAGNOSTICS v_removed = ROW_COUNT;
  END IF;

  UPDATE public.class_sessions
     SET status = 'cancelled',
         cancel_reason = btrim(_reason),
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         -- ยกเลิกแล้วไม่นับคะแนนเสมอ ไม่ว่าจะเก็บระเบียนไว้หรือไม่
         counts_for_grade = false,
         closed_at = COALESCE(closed_at, now())
   WHERE id = _session_id;

  -- นัดชดเชย (ถ้าเลือก) ผูกกลับกับคาบที่ยกเลิก
  IF _makeup_start IS NOT NULL THEN
    INSERT INTO public.class_sessions
      (course_id, instructor_id, started_at, status, late_after_minutes,
       scheduled_start, scheduled_end, mode, title, makeup_of_session_id)
    VALUES (s.course_id, s.instructor_id, _makeup_start, 'scheduled',
            COALESCE(s.late_after_minutes, 15), _makeup_start, _makeup_end, 'auto',
            'คาบชดเชย', _session_id)
    RETURNING id INTO v_makeup;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, related_id, action_required, status)
  SELECT ce.student_id, 'class_cancelled', 'คาบเรียนถูกยกเลิก',
    v_course.code || ' ' || v_course.name || ' คาบวันที่ '
      || to_char(s.started_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI')
      || ' ถูกยกเลิก — ' || btrim(_reason)
      || CASE WHEN v_makeup IS NOT NULL
              THEN ' · นัดชดเชยวันที่ '
                   || to_char(_makeup_start AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI')
              ELSE '' END
      || ' · คาบนี้ไม่ถูกนับในคะแนนการเข้าเรียน',
    s.course_id, false, 'unread'
  FROM public.course_enrollments ce
  WHERE ce.course_id = s.course_id AND ce.status = 'confirmed'
    AND ce.student_id IS NOT NULL AND ce.withdrawn_at IS NULL;
  v_notified := (SELECT count(*) FROM public.course_enrollments ce
                  WHERE ce.course_id = s.course_id AND ce.status = 'confirmed'
                    AND ce.student_id IS NOT NULL AND ce.withdrawn_at IS NULL);

  PERFORM public.log_audit_event(
    'class_session.cancel', 'class_session', _session_id::text,
    'ยกเลิกคาบเรียน ' || to_char(s.started_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI')
      || CASE WHEN _records = 'delete' THEN ' · ลบระเบียนการเช็คชื่อ ' || v_removed::text || ' รายการ'
              ELSE ' · เก็บระเบียนไว้เป็นหลักฐานแต่ไม่นับคะแนน' END
      || CASE WHEN v_makeup IS NOT NULL THEN ' · นัดชดเชยแล้ว' ELSE '' END,
    NULL::jsonb,
    jsonb_build_object('records', _records, 'makeup_session_id', v_makeup),
    _reason);

  RETURN jsonb_build_object('removed_records', v_removed, 'notified', v_notified,
                            'makeup_session_id', v_makeup);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_class_session(uuid, text, text, timestamptz, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_class_session(uuid, text, text, timestamptz, timestamptz)
  TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. คะแนนการเข้าเรียนของนักศึกษาหนึ่งคน — คืนที่มาของตัวเลขทุกตัว
--
--    คาบที่นับ = คาบที่ปิดแล้ว (status = 'closed')
--                และ counts_for_grade = true (ไม่ใช่คาบที่ยกเลิก)
--                และอยู่ในช่วงที่นักศึกษาคนนั้นอยู่ในรายวิชา
--                (started_at >= joined_at และ <= withdrawn_at ถ้ามี)
--
--    คะแนน = (Σ ค่าน้ำหนักตามสถานะ ÷ จำนวนคาบที่นับ) × weight_percent
--    คาบที่นับแต่ไม่มีระเบียนการเช็คชื่อ ถือเป็น "ขาดเรียน" (credit_absent)
--    เพราะการปิดคาบตามปกติจะบันทึกขาดให้ทุกคนที่ไม่ได้สแกนอยู่แล้ว
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.attendance_score_detail(
  _component_id uuid,
  _student_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH c AS (
    SELECT gc.*, gc.course_id AS cid FROM public.grade_components gc WHERE gc.id = _component_id
  ),
  win AS (
    SELECT ce.joined_at, ce.withdrawn_at
    FROM public.course_enrollments ce, c
    WHERE ce.course_id = c.cid AND ce.student_id = _student_id AND ce.status = 'confirmed'
    LIMIT 1
  ),
  counted AS (
    SELECT cs.id, cs.started_at
    FROM public.class_sessions cs, c
    LEFT JOIN win ON true
    WHERE cs.course_id = c.cid
      AND cs.status = 'closed'
      AND cs.counts_for_grade
      AND (win.joined_at IS NULL OR cs.started_at >= win.joined_at)
      AND (win.withdrawn_at IS NULL OR cs.started_at <= win.withdrawn_at)
  ),
  marked AS (
    SELECT ct.id,
           COALESCE(ar.status, 'absent') AS status
    FROM counted ct
    LEFT JOIN public.attendance_records ar
           ON ar.session_id = ct.id AND ar.student_id = _student_id
  ),
  tally AS (
    SELECT
      count(*)::int                                          AS counted_sessions,
      count(*) FILTER (WHERE status = 'on_time')::int         AS n_on_time,
      count(*) FILTER (WHERE status = 'late')::int            AS n_late,
      count(*) FILTER (WHERE status = 'excused')::int         AS n_excused,
      count(*) FILTER (WHERE status = 'absent')::int          AS n_absent
    FROM marked
  ),
  cancelled AS (
    SELECT count(*)::int AS n FROM public.class_sessions cs, c
     WHERE cs.course_id = c.cid AND (cs.status = 'cancelled' OR NOT cs.counts_for_grade)
  ),
  credited AS (
    SELECT t.*,
           t.n_on_time * (SELECT credit_on_time FROM c)
           + t.n_late    * (SELECT credit_late FROM c)
           + t.n_excused * (SELECT credit_excused FROM c)
           + t.n_absent  * (SELECT credit_absent FROM c) AS credit_sum
    FROM tally t
  )
  SELECT jsonb_build_object(
    'counted_sessions',  cr.counted_sessions,
    'cancelled_sessions', (SELECT n FROM cancelled),
    'on_time',           cr.n_on_time,
    'late',              cr.n_late,
    'excused',           cr.n_excused,
    'absent',            cr.n_absent,
    'credit_sum',        round(cr.credit_sum, 4),
    'ratio',             CASE WHEN cr.counted_sessions > 0
                              THEN round(cr.credit_sum / cr.counted_sessions, 6) ELSE NULL END,
    'weight',            (SELECT weight_percent FROM c),
    'earned',            CASE WHEN cr.counted_sessions > 0
                              THEN round(cr.credit_sum / cr.counted_sessions
                                         * (SELECT weight_percent FROM c), 4)
                              ELSE 0 END,
    'credits',           jsonb_build_object(
                           'on_time', (SELECT credit_on_time FROM c),
                           'late',    (SELECT credit_late FROM c),
                           'excused', (SELECT credit_excused FROM c),
                           'absent',  (SELECT credit_absent FROM c)),
    'joined_at',         (SELECT joined_at FROM win),
    'withdrawn_at',      (SELECT withdrawn_at FROM win))
  FROM credited cr;
$$;

GRANT EXECUTE ON FUNCTION public.attendance_score_detail(uuid, uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. เขียนคะแนนเข้าเรียนลงตารางคะแนน
--    แทน recalc_attendance_scores เดิมทั้งหมด
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recalc_attendance_scores(_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp public.grade_components%ROWTYPE;
  v_item_id uuid;
  rec record;
  d jsonb;
  v_score numeric;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_skipped_names text[] := '{}';
  v_max numeric := 100;
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คำนวณคะแนนของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_comp FROM public.grade_components
   WHERE course_id = _course_id AND score_mode = 'auto_attendance'
   ORDER BY position LIMIT 1;

  IF v_comp.id IS NULL THEN
    RAISE EXCEPTION 'รายวิชานี้ยังไม่มีหมวดคะแนนที่ตั้งให้คำนวณจากการเข้าเรียน'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- รายการคะแนนของหมวดนี้ (สร้างให้ถ้ายังไม่มี) เก็บเป็นคะแนนดิบเต็ม 100
  SELECT id, max_score INTO v_item_id, v_max
  FROM public.grade_items
   WHERE component_id = v_comp.id AND source = 'attendance'
   ORDER BY position LIMIT 1;

  IF v_item_id IS NULL THEN
    INSERT INTO public.grade_items
      (course_id, component_id, name, category, max_score, weight, source)
    VALUES (_course_id, v_comp.id, 'คะแนนการเข้าเรียน', 'attendance', 100, 0, 'attendance')
    RETURNING id, max_score INTO v_item_id, v_max;
  END IF;
  v_max := COALESCE(NULLIF(v_max, 0), 100);

  FOR rec IN
    SELECT ce.student_id,
           COALESCE(p.name, 'นักศึกษา') AS name
    FROM public.course_enrollments ce
    LEFT JOIN public.profiles p ON p.user_id = ce.student_id
    WHERE ce.course_id = _course_id
      AND ce.status = 'confirmed'
      AND ce.student_id IS NOT NULL
      -- นักศึกษาที่ถอนรายวิชาไม่ถูกคำนวณและไม่ปรากฏในตารางคะแนน
      AND ce.withdrawn_at IS NULL
  LOOP
    d := public.attendance_score_detail(v_comp.id, rec.student_id);

    IF (d->>'counted_sessions')::int = 0 THEN
      -- ยังไม่มีคาบที่นับได้เลย (เพิ่งเข้าร่วม หรือทุกคาบถูกยกเลิก)
      -- ไม่เขียน 0 ลงไป เพราะ 0 หมายถึง "ตรวจแล้วได้ศูนย์" ซึ่งไม่จริง
      v_skipped := v_skipped + 1;
      v_skipped_names := v_skipped_names || rec.name;
      CONTINUE;
    END IF;

    v_score := round(((d->>'ratio')::numeric) * v_max, 2);

    INSERT INTO public.student_grades (grade_item_id, student_id, score, note)
    VALUES (v_item_id, rec.student_id, v_score,
            'คำนวณอัตโนมัติ · ตรงเวลา ' || (d->>'on_time') || ' สาย ' || (d->>'late')
            || ' ลา ' || (d->>'excused') || ' ขาด ' || (d->>'absent')
            || ' จาก ' || (d->>'counted_sessions') || ' คาบที่นับ')
    ON CONFLICT (grade_item_id, student_id)
    DO UPDATE SET score = EXCLUDED.score, note = EXCLUDED.note;
    v_updated := v_updated + 1;
  END LOOP;

  PERFORM public.log_audit_event(
    'attendance.recalc', 'course', _course_id::text,
    'คำนวณคะแนนการเข้าเรียน ' || v_updated::text || ' คน · ข้าม ' || v_skipped::text
      || ' คน (ยังไม่มีคาบที่นับได้) · เกณฑ์ ตรงเวลา ' || v_comp.credit_on_time::text
      || ' สาย ' || v_comp.credit_late::text || ' ลา ' || v_comp.credit_excused::text
      || ' ขาด ' || v_comp.credit_absent::text,
    NULL::jsonb, NULL::jsonb, NULL::text);

  RETURN jsonb_build_object(
    'updated', v_updated,
    'skipped', v_skipped,
    'skipped_names', to_jsonb(v_skipped_names),
    'grade_item_id', v_item_id,
    'credits', jsonb_build_object(
      'on_time', v_comp.credit_on_time, 'late', v_comp.credit_late,
      'excused', v_comp.credit_excused, 'absent', v_comp.credit_absent));
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_attendance_scores(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalc_attendance_scores(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. ตัวอย่างผลของเกณฑ์ปัจจุบันกับนักศึกษาจริงสองสามคน (ข้อ 3.4)
--    ให้อาจารย์ปรับค่าแล้วเห็นผลทันทีก่อนบันทึก
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.preview_attendance_scores(
  _component_id uuid,
  _credit_on_time numeric DEFAULT NULL,
  _credit_late numeric DEFAULT NULL,
  _credit_excused numeric DEFAULT NULL,
  _credit_absent numeric DEFAULT NULL,
  _limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_course_id uuid;
  v_weight numeric;
  rec record;
  d jsonb;
  out jsonb := '[]'::jsonb;
  v_ratio numeric;
BEGIN
  SELECT course_id, weight_percent INTO v_course_id, v_weight
  FROM public.grade_components WHERE id = _component_id;
  IF v_course_id IS NULL THEN RETURN out; END IF;

  FOR rec IN
    SELECT ce.student_id, COALESCE(p.name, 'นักศึกษา') AS name,
           COALESCE(p.student_code, '-') AS code
    FROM public.course_enrollments ce
    LEFT JOIN public.profiles p ON p.user_id = ce.student_id
    WHERE ce.course_id = v_course_id AND ce.status = 'confirmed'
      AND ce.student_id IS NOT NULL AND ce.withdrawn_at IS NULL
    ORDER BY p.student_code NULLS LAST
    LIMIT GREATEST(COALESCE(_limit, 5), 1)
  LOOP
    d := public.attendance_score_detail(_component_id, rec.student_id);

    -- คิดใหม่ด้วยเกณฑ์ที่ส่งมา (ถ้าไม่ส่งใช้ค่าที่บันทึกไว้)
    IF (d->>'counted_sessions')::int > 0 THEN
      v_ratio := (
        (d->>'on_time')::numeric * COALESCE(_credit_on_time, (d->'credits'->>'on_time')::numeric)
        + (d->>'late')::numeric   * COALESCE(_credit_late,    (d->'credits'->>'late')::numeric)
        + (d->>'excused')::numeric * COALESCE(_credit_excused, (d->'credits'->>'excused')::numeric)
        + (d->>'absent')::numeric  * COALESCE(_credit_absent,  (d->'credits'->>'absent')::numeric)
      ) / (d->>'counted_sessions')::numeric;
    ELSE
      v_ratio := NULL;
    END IF;

    out := out || jsonb_build_object(
      'student_id', rec.student_id, 'name', rec.name, 'code', rec.code,
      'on_time', (d->>'on_time')::int, 'late', (d->>'late')::int,
      'excused', (d->>'excused')::int, 'absent', (d->>'absent')::int,
      'counted_sessions', (d->>'counted_sessions')::int,
      'cancelled_sessions', (d->>'cancelled_sessions')::int,
      'ratio', CASE WHEN v_ratio IS NULL THEN NULL ELSE round(v_ratio, 4) END,
      'earned', CASE WHEN v_ratio IS NULL THEN NULL
                     ELSE round(v_ratio * v_weight, 2) END,
      'weight', v_weight);
  END LOOP;

  RETURN out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_attendance_scores(uuid, numeric, numeric, numeric, numeric, integer)
  TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. แก้เกณฑ์หลังมีคาบปิดแล้ว ต้องรู้ว่ากระทบกี่คน (ข้อ 3.4)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.attendance_criteria_impact(_component_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH c AS (SELECT course_id FROM public.grade_components WHERE id = _component_id)
  SELECT jsonb_build_object(
    'closed_sessions', (SELECT count(*) FROM public.class_sessions cs, c
                         WHERE cs.course_id = c.course_id AND cs.status = 'closed'
                           AND cs.counts_for_grade),
    'affected_students', (SELECT count(*) FROM public.course_enrollments ce, c
                           WHERE ce.course_id = c.course_id AND ce.status = 'confirmed'
                             AND ce.student_id IS NOT NULL AND ce.withdrawn_at IS NULL),
    'has_recorded_scores', EXISTS (
      SELECT 1 FROM public.grade_items gi
      JOIN public.student_grades sg ON sg.grade_item_id = gi.id AND sg.score IS NOT NULL
      WHERE gi.component_id = _component_id));
$$;

GRANT EXECUTE ON FUNCTION public.attendance_criteria_impact(uuid) TO authenticated;
