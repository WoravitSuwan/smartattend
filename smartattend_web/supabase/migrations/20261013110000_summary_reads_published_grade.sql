-- ═══════════════════════════════════════════════════════════════════════════
--  DEF-005 — หน้านักศึกษาแสดงเกรดไม่ตรงกับเกรดที่ประกาศเป็นทางการ
--
--  อาการที่พบจากการทดสอบ (กรณี F-16d)
--    1. ประกาศผล STU1 คะแนนรวม 92.10 → บันทึกเกรด A ใน course_final_grades
--    2. อาจารย์ปลดล็อกพร้อมเหตุผล แล้วแก้คะแนนบางช่อง
--    3. ยังไม่ได้สั่งประกาศผลใหม่ course_final_grades จึงยังเป็น A
--    4. หน้าจอนักศึกษาแสดง C+ ขณะที่เกรดที่ส่งทะเบียนคือ A
--
--  สาเหตุ
--    ฟังก์ชันนี้ "คำนวณเกรดใหม่ทุกครั้ง" จาก grade_letter(earned/used*100)
--    โดยไม่เคยอ่านตาราง course_final_grades ซึ่งเป็นทะเบียนเกรดที่เป็นทางการ
--    และเป็นที่เดียวที่เก็บเกรดพิเศษอย่าง I หรือ W ที่อาจารย์กำหนดเอง
--    ผลข้างเคียงอีกข้อคือ ถ้าอาจารย์ให้เกรด I ตอนประกาศผล นักศึกษาจะไม่เห็น
--    เกรดนั้น แต่จะเห็นเกรดที่คำนวณจากคะแนนแทน
--
--  หลักการที่ใช้แก้
--    ประกาศผลแล้ว  → อ่านเกรดจาก course_final_grades โดยตรง ห้ามคำนวณใหม่
--    ยังไม่ประกาศผล → นักศึกษาไม่เห็นตัวอักษรเกรดใด ๆ (พฤติกรรมเดิมถูกอยู่แล้ว)
--                     อาจารย์ยังเห็นเกรดที่คำนวณได้ เพื่อใช้ตรวจก่อนประกาศ
--                     แต่ grade_is_final จะเป็น false เสมอ หน้าจอจึงแยกออกได้
--
--  เพิ่มคีย์ grade_source ให้หน้าจอบอกได้ว่าเกรดที่เห็นมาจากไหน
--    'published'  = อ่านจากทะเบียนเกรดที่ประกาศแล้ว (เชื่อถือได้)
--    'preview'    = คำนวณให้อาจารย์ดูก่อนประกาศ ยังเปลี่ยนได้
--    NULL         = ยังไม่มีเกรดให้แสดง
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_student_score_summary(
  _course_id uuid,
  _student_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_target uuid := COALESCE(_student_id, auth.uid());
  v_is_staff boolean;
  v_published boolean;
  v_blocked boolean;
  v_components jsonb := '[]'::jsonb;
  v_earned numeric := 0;
  v_used numeric := 0;
  v_declared numeric := 0;
  v_masked numeric := 0;
  v_final_grade text;        -- เกรดที่ประกาศไว้จริงในทะเบียน
  v_final_score numeric;     -- คะแนนรวม ณ เวลาที่ประกาศ
  v_grade text;
  v_grade_source text;
  rec record;
  cs jsonb;
BEGIN
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_is_staff := public.is_course_instructor(_course_id, auth.uid())
                OR internal.has_role(auth.uid(), 'admin'::app_role);

  IF NOT v_is_staff AND v_target <> auth.uid() THEN
    RAISE EXCEPTION 'ดูคะแนนของนักศึกษาคนอื่นไม่ได้' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT final_grade_published INTO v_published FROM public.courses WHERE id = _course_id;
  SELECT attendance_blocked INTO v_blocked FROM public.course_enrollments
   WHERE course_id = _course_id AND student_id = v_target;

  -- อ่านเกรดที่ประกาศไว้ — นี่คือเกรดที่ส่งทะเบียนและเป็นความจริงเพียงหนึ่งเดียว
  SELECT cfg.grade, cfg.score INTO v_final_grade, v_final_score
  FROM public.course_final_grades cfg
  WHERE cfg.course_id = _course_id AND cfg.student_id = v_target;

  FOR rec IN
    SELECT gc.id, gc.name, gc.kind, gc.weight_percent, gc.is_final_exam,
           gc.calc_mode, gc.drop_lowest
    FROM public.grade_components gc
    WHERE gc.course_id = _course_id
    ORDER BY gc.position, gc.name
  LOOP
    v_declared := v_declared + rec.weight_percent;
    cs := public.component_score(rec.id, v_target);

    v_earned := v_earned + COALESCE((cs->>'earned')::numeric, 0);
    v_used   := v_used   + COALESCE((cs->>'max_points')::numeric, 0);

    IF rec.is_final_exam AND NOT COALESCE(v_published, false) AND NOT v_is_staff THEN
      v_masked := v_masked + rec.weight_percent;
    END IF;

    v_components := v_components || jsonb_build_object(
      'component_id',  rec.id,
      'name',          rec.name,
      'kind',          rec.kind,
      'weight',        rec.weight_percent,
      'calc_mode',     rec.calc_mode,
      'drop_lowest',   rec.drop_lowest,
      'earned',        round(COALESCE((cs->>'earned')::numeric, 0), 2),
      'max_points',    round(COALESCE((cs->>'max_points')::numeric, 0), 2),
      'graded_items',  (cs->>'graded_items')::integer,
      'total_items',   (cs->>'total_items')::integer,
      'dropped',       (cs->>'dropped')::integer,
      'has_any_score', (cs->>'has_any_score')::boolean,
      'planned_item_count', (cs->>'planned_item_count')::integer,
      'counts_toward',      (cs->>'counts_toward')::integer,
      'masked',        rec.is_final_exam AND NOT COALESCE(v_published, false)
                       AND NOT v_is_staff);
  END LOOP;

  -- ── เกรดที่จะแสดง ──
  IF COALESCE(v_published, false) AND v_final_grade IS NOT NULL THEN
    -- ประกาศผลแล้ว: อ่านจากทะเบียน ห้ามคำนวณใหม่
    -- ครอบคลุมเกรดพิเศษ (I / W) ที่คำนวณจากคะแนนไม่ได้ด้วย
    v_grade := v_final_grade;
    v_grade_source := 'published';
  ELSIF v_is_staff AND v_used > 0 THEN
    -- ยังไม่ประกาศ: ให้อาจารย์ดูเกรดที่คำนวณได้เพื่อตรวจก่อนประกาศ
    v_grade := public.grade_letter(_course_id, v_earned / v_used * 100);
    v_grade_source := 'preview';
  ELSE
    -- นักศึกษาก่อนประกาศผล: ไม่แสดงตัวอักษรเกรดใด ๆ
    v_grade := NULL;
    v_grade_source := NULL;
  END IF;

  RETURN jsonb_build_object(
    'course_id',        _course_id,
    'student_id',       v_target,
    'components',       v_components,
    'earned',           round(v_earned, 2),
    'used_weight',      round(v_used, 2),
    'declared_weight',  round(v_declared, 2),
    'masked_weight',    round(v_masked, 2),
    'normalized',       CASE WHEN v_used > 0
                             THEN round(v_earned / v_used * 100, 2) ELSE NULL END,
    'fully_graded',     v_used >= 99.99,
    'final_published',  COALESCE(v_published, false),
    'grade',            v_grade,
    'grade_source',     v_grade_source,
    -- คะแนนรวม ณ เวลาที่ประกาศ ใช้แสดงคู่กับเกรดที่ประกาศ
    'published_score',  v_final_score,
    'grade_is_final',   COALESCE(v_published, false) AND v_final_grade IS NOT NULL,
    'attendance_blocked', COALESCE(v_blocked, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_score_summary(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_score_summary(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_student_score_summary(uuid, uuid) IS
  'สรุปคะแนนรายวิชาของนักศึกษาหนึ่งคน เมื่อประกาศผลแล้วจะอ่านเกรดจาก '
  'course_final_grades โดยตรง ไม่คำนวณใหม่ เพื่อให้ตรงกับเกรดที่ส่งทะเบียนเสมอ';
