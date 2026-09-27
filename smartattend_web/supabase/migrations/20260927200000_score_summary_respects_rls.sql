-- ═══════════════════════════════════════════════════════════════════════════
--  ปิดบังคะแนนปลายภาคให้มีจุดบังคับ "จุดเดียว" คือ RLS
--
--  ปัญหาที่พบ
--    get_student_score_summary() เป็น SECURITY DEFINER จึงข้าม RLS แล้วเขียน
--    ตรรกะปิดบังของตัวเองขึ้นมาใหม่ ซึ่งหลวมกว่า RLS อยู่หนึ่งกรณี
--
--      RLS ปิดบังเมื่อ  gi.category = 'final' OR gc.is_final_exam
--      RPC ปิดบังเมื่อ  gc.is_final_exam เท่านั้น
--
--    ดังนั้นรายการที่ category = 'final' แต่อยู่ในหมวดที่ไม่ได้ติดธง
--    is_final_exam จะถูก RLS ปิดบัง แต่ "หลุดผ่าน RPC นี้" ได้
--    ซึ่งเป็นเส้นทางที่หน้าจอนักศึกษาเรียกใช้จริง
--
--  วิธีแก้ที่ไม่ทำให้ปัญหานี้กลับมาอีก
--    เอา SECURITY DEFINER ออก ให้ฟังก์ชันอ่านข้อมูลด้วยสิทธิ์ของผู้เรียกเอง
--    แล้วให้ RLS เป็นคนปิดบัง — ตรรกะปิดบังจึงมีที่เดียว ไม่มีสองชุดให้หลุดกัน
--    (นักศึกษามีนโยบายอ่านคะแนนของตัวเอง อาจารย์มีนโยบาย FOR ALL ของวิชาตัวเอง
--     อยู่แล้ว จึงไม่ต้องใช้ SECURITY DEFINER เพื่อเข้าถึงข้อมูล)
--
--  พลอยแก้อีกสามข้อในฟังก์ชันเดียวกัน
--    1. ของเดิมใช้ sum(gi.max_score) ของ "ทุกรายการในหมวด" เป็นตัวหาร
--       รายการที่ยังไม่ตรวจจึงถูกนับเป็นศูนย์ ผิดกฎหลักของการคิดคะแนน
--    2. ของเดิมคิดแบบ proportional อย่างเดียว ไม่รู้จัก calc_mode / drop_lowest
--    3. ของเดิมคืนตัวอักษรเกรดทันทีที่ประกาศผล แม้ตรวจยังไม่ครบ
--       ตอนนี้ต้องครบทั้งสองเงื่อนไข: ตรวจครบน้ำหนัก 100 และประกาศผลแล้ว
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_student_score_summary(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_student_score_summary(
  _course_id uuid,
  _student_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
-- ไม่ใช้ SECURITY DEFINER โดยเจตนา — ให้ RLS เป็นคนปิดบังคะแนนปลายภาค
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

  FOR rec IN
    SELECT gc.id, gc.name, gc.kind, gc.weight_percent, gc.is_final_exam,
           gc.calc_mode, gc.drop_lowest
    FROM public.grade_components gc
    WHERE gc.course_id = _course_id
    ORDER BY gc.position, gc.name
  LOOP
    v_declared := v_declared + rec.weight_percent;

    -- component_score() อ่าน grade_items/student_grades ด้วยสิทธิ์ของผู้เรียก
    -- แถวที่ RLS ปิดบังจะไม่ถูกมองเห็น จึงนับเป็น "ยังไม่ตรวจ" โดยอัตโนมัติ
    -- ไม่ถูกนับเป็นศูนย์ และไม่ถูกนับในตัวหาร
    cs := public.component_score(rec.id, v_target);

    v_earned := v_earned + COALESCE((cs->>'earned')::numeric, 0);
    v_used   := v_used   + COALESCE((cs->>'max_points')::numeric, 0);

    -- หมวดที่ถูกปิดบังอยู่ บอกได้แค่ว่ากินน้ำหนักเท่าไร ไม่บอกคะแนน
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
      -- ถูกปิดบังเมื่อหมวดเป็นปลายภาคและยังไม่ประกาศ หรือเมื่อหมวดมีรายการอยู่
      -- แต่ผู้เรียกมองไม่เห็นรายการเลย (RLS ซ่อนไว้)
      'masked',        rec.is_final_exam AND NOT COALESCE(v_published, false)
                       AND NOT v_is_staff);
  END LOOP;

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
    -- ตัวอักษรเกรดต้องครบสองเงื่อนไข: ตรวจครบน้ำหนัก 100 และประกาศผลแล้ว
    -- (อาจารย์เห็นเกรดคาดการณ์ได้เสมอเพื่อใช้ตัดสินใจ แต่ต้องมีคะแนนแล้ว)
    'grade',            CASE
                          WHEN v_used <= 0 THEN NULL
                          WHEN v_is_staff THEN
                            public.grade_letter(_course_id, v_earned / v_used * 100)
                          WHEN v_used >= 99.99 AND COALESCE(v_published, false) THEN
                            public.grade_letter(_course_id, v_earned / v_used * 100)
                          ELSE NULL
                        END,
    'grade_is_final',   v_used >= 99.99 AND COALESCE(v_published, false),
    'attendance_blocked', COALESCE(v_blocked, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_score_summary(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_score_summary(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_student_score_summary(uuid, uuid) IS
  'สรุปคะแนนของนักศึกษาหนึ่งคนในรายวิชาหนึ่ง เป็น SECURITY INVOKER โดยเจตนา '
  'เพื่อให้การปิดบังคะแนนปลายภาคมีจุดบังคับเดียวคือ RLS ห้ามเปลี่ยนเป็น '
  'SECURITY DEFINER เพราะจะต้องเขียนตรรกะปิดบังขึ้นมาใหม่และหลุดกันได้อีก';
