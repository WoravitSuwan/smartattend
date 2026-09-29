-- ═══════════════════════════════════════════════════════════════════════════
--  จำนวนงานที่วางแผนไว้ต่อหมวด — แก้ปัญหา "คะแนนหายไป" ที่นักศึกษาเข้าใจผิด
--
--  อาการที่พบจากการทดสอบกับผู้ใช้จริง
--    หมวด LAB น้ำหนัก 20% มีงาน 2 ชิ้น เต็มชิ้นละ 1 นักศึกษาได้เต็มทั้งสอง
--    หน้าจอแสดง 20.0 / 20 ซึ่ง "ถูกตามสูตร" แต่สื่อว่าได้คะแนน LAB เต็มทั้งเทอมแล้ว
--    พออาจารย์โพสต์งานชิ้นที่ 3 ตัวเลขลดลงเอง นักศึกษาเข้าใจว่าคะแนนหายไป
--
--  ที่มาของตัวเลข 20 คือ ตัวหารของสูตรคือคะแนนเต็มของงาน "ที่มีอยู่ตอนนั้น"
--  (pr_max_all) ซึ่งโตขึ้นเรื่อย ๆ ทุกครั้งที่โพสต์งานเพิ่ม
--
--  วิธีแก้ ให้อาจารย์ระบุได้ว่าตั้งใจจะมีงานกี่ชิ้นในหมวดนี้
--    ตัวหารจะกลายเป็นคะแนนเต็มที่ "คาดว่าจะมีทั้งหมด" แทน
--    LAB 10 ชิ้น เต็มชิ้นละ 1 -> ตัวหาร 10 -> ได้ 2 ชิ้นเต็มจะแสดง 4.0 / 4
--    ซึ่งเทียบกับน้ำหนักหมวด 20% แล้วเห็นชัดว่ายังไม่เต็ม
--
--  ⚠️ เข้ากันได้กับของเดิมทั้งหมด
--     planned_item_count เป็น NULL = พฤติกรรมเดิมทุกประการ ไม่มีคะแนนใครเปลี่ยน
--     ใช้กับโหมด proportional เท่านั้น โหมด weighted_items ไม่เกี่ยวข้อง
--     เพราะน้ำหนักย่อยถูกบังคับให้รวมเป็น 100 อยู่แล้ว ตัวหารจึงคงที่อยู่แล้ว
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.grade_components
  ADD COLUMN IF NOT EXISTS planned_item_count integer;

ALTER TABLE public.grade_components DROP CONSTRAINT IF EXISTS grade_components_planned_item_count_check;
ALTER TABLE public.grade_components
  ADD CONSTRAINT grade_components_planned_item_count_check
  CHECK (planned_item_count IS NULL OR (planned_item_count > 0 AND planned_item_count <= 200));

COMMENT ON COLUMN public.grade_components.planned_item_count IS
  'จำนวนงานที่อาจารย์วางแผนจะมีในหมวดนี้ทั้งเทอม (ไม่บังคับ) '
  'NULL = คิดจากงานที่มีอยู่จริงเหมือนเดิม '
  'ถ้ากรอกไว้ ตัวหารของโหมด proportional จะเป็นคะแนนเต็มที่คาดว่าจะมีทั้งหมด '
  'ประมาณจากคะแนนเต็มเฉลี่ยของงานที่มีอยู่ × จำนวนที่วางแผนไว้';

-- ───────────────────────────────────────────────────────────────────────────
--  component_score() — เพิ่มการใช้ planned_item_count กับโหมด proportional
--
--  ตัวหารใหม่ = GREATEST(คะแนนเต็มที่มีจริง, คะแนนเต็มเฉลี่ย × จำนวนที่วางแผน)
--  ใช้ GREATEST เพื่อให้เมื่องานจริงเกินที่วางแผนไว้ ตัวหารไม่หดลงต่ำกว่าความจริง
--  ซึ่งจะทำให้คะแนนเกินน้ำหนักหมวด
--
--  คืนค่าเพิ่มสองตัวให้หน้าจออธิบายผู้ใช้ได้
--    planned_item_count  จำนวนที่วางแผนไว้ (null ถ้าไม่ได้ตั้ง)
--    counts_toward       จำนวนงานที่ใช้เป็นตัวหาร (ที่วางแผน หรือที่มีจริง)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.component_score(
  _component_id uuid,
  _student_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH c AS (
    SELECT * FROM public.grade_components WHERE id = _component_id
  ),
  rows AS (
    SELECT gi.id,
           gi.position,
           gi.max_score,
           CASE WHEN c.calc_mode = 'weighted_items'
                THEN COALESCE(gi.weight_in_component, 0) ELSE 0 END AS w,
           sg.score,
           CASE WHEN sg.score IS NULL THEN NULL
                ELSE sg.score / gi.max_score END AS ratio
    FROM c
    JOIN public.grade_items gi ON gi.component_id = c.id
    LEFT JOIN public.student_grades sg
           ON sg.grade_item_id = gi.id AND sg.student_id = _student_id
    WHERE gi.max_score IS NOT NULL AND gi.max_score > 0
  ),
  graded AS (SELECT * FROM rows WHERE ratio IS NOT NULL),
  counts AS (
    SELECT (SELECT count(*) FROM rows)::int   AS total_items,
           (SELECT count(*) FROM graded)::int AS graded_items
  ),
  dropn AS (
    SELECT LEAST(
             COALESCE((SELECT drop_lowest FROM c), 0),
             GREATEST((SELECT graded_items FROM counts) - 1, 0)
           ) AS d
  ),
  dropped_ids AS (
    SELECT id FROM graded
     ORDER BY ratio ASC, position ASC, id ASC
     LIMIT (SELECT d FROM dropn)
  ),
  kept AS (
    SELECT * FROM graded WHERE id NOT IN (SELECT id FROM dropped_ids)
  ),
  agg AS (
    SELECT
      COALESCE((SELECT sum(ratio * w) FROM kept), 0)                 AS wi_earned,
      COALESCE((SELECT sum(w) FROM kept), 0)                         AS wi_w_graded,
      COALESCE((SELECT sum(w) FROM rows
                 WHERE id NOT IN (SELECT id FROM dropped_ids)), 0)   AS wi_w_all,
      COALESCE((SELECT sum(score) FROM kept), 0)                     AS pr_earned_raw,
      COALESCE((SELECT sum(max_score) FROM kept), 0)                 AS pr_max_graded,
      COALESCE((SELECT sum(max_score) FROM rows
                 WHERE id NOT IN (SELECT id FROM dropped_ids)), 0)   AS pr_max_all
  ),
  -- ตัวหารที่คาดไว้ คิดจากคะแนนเต็มเฉลี่ยของงานที่มีอยู่จริง
  -- ถ้ายังไม่มีงานเลย ประมาณไม่ได้ จึงถอยกลับไปใช้ของที่มีจริง
  planned AS (
    SELECT
      (SELECT planned_item_count FROM c) AS n,
      CASE
        WHEN (SELECT planned_item_count FROM c) IS NULL
          OR (SELECT total_items FROM counts) = 0
        THEN NULL
        ELSE (SELECT sum(max_score) / count(*) FROM rows)
             * (SELECT planned_item_count FROM c)
      END AS expected_max
  ),
  denom AS (
    SELECT GREATEST(a.pr_max_all, COALESCE(p.expected_max, 0)) AS pr_denom
    FROM agg a CROSS JOIN planned p
  )
  SELECT CASE
    WHEN (SELECT id FROM c) IS NULL OR (SELECT graded_items FROM counts) = 0 THEN
      jsonb_build_object(
        'earned', 0, 'max_points', 0,
        'graded_items', COALESCE((SELECT graded_items FROM counts), 0),
        'total_items', COALESCE((SELECT total_items FROM counts), 0),
        'dropped', 0, 'has_any_score', false,
        'planned_item_count', (SELECT n FROM planned),
        'counts_toward', COALESCE((SELECT n FROM planned),
                                  COALESCE((SELECT total_items FROM counts), 0)))
    WHEN (SELECT calc_mode FROM c) = 'weighted_items' THEN
      jsonb_build_object(
        'earned', round(a.wi_earned / 100.0 * (SELECT weight_percent FROM c), 6),
        'max_points', round(
          CASE WHEN a.wi_w_all > 0
               THEN a.wi_w_graded / 100.0 * (SELECT weight_percent FROM c)
               ELSE 0 END, 6),
        'graded_items', (SELECT count(*) FROM kept),
        'total_items', (SELECT total_items FROM counts),
        'dropped', (SELECT d FROM dropn), 'has_any_score', true,
        -- โหมดนี้ไม่ใช้ planned เพราะน้ำหนักย่อยรวมเป็น 100 อยู่แล้ว
        'planned_item_count', NULL,
        'counts_toward', (SELECT total_items FROM counts))
    ELSE
      jsonb_build_object(
        'earned', round(
          CASE WHEN (SELECT pr_denom FROM denom) > 0
               THEN a.pr_earned_raw / (SELECT pr_denom FROM denom)
                    * (SELECT weight_percent FROM c)
               ELSE 0 END, 6),
        'max_points', round(
          CASE WHEN (SELECT pr_denom FROM denom) > 0
               THEN a.pr_max_graded / (SELECT pr_denom FROM denom)
                    * (SELECT weight_percent FROM c)
               ELSE 0 END, 6),
        'graded_items', (SELECT count(*) FROM kept),
        'total_items', (SELECT total_items FROM counts),
        'dropped', (SELECT d FROM dropn), 'has_any_score', true,
        'planned_item_count', (SELECT n FROM planned),
        'counts_toward', COALESCE((SELECT n FROM planned), (SELECT total_items FROM counts)))
  END
  FROM agg a;
$$;

GRANT EXECUTE ON FUNCTION public.component_score(uuid, uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
--  get_student_score_summary() — ส่งค่าที่เพิ่มมาต่อให้หน้าจอ
--  ที่เหลือคงเดิมทุกบรรทัด รวมถึงการเป็น SECURITY INVOKER ซึ่งห้ามเปลี่ยน
-- ───────────────────────────────────────────────────────────────────────────
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
      -- ใหม่: ให้หน้าจอบอกได้ว่า "ตรวจแล้ว 2 จาก 10 ชิ้นที่วางแผนไว้"
      'planned_item_count', (cs->>'planned_item_count')::integer,
      'counts_toward',      (cs->>'counts_toward')::integer,
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

-- ───────────────────────────────────────────────────────────────────────────
--  RPC เล็ก ๆ สำหรับตั้ง planned_item_count
-- ───────────────────────────────────────────────────────────────────────────
/** ตั้ง planned_item_count จาก payload ที่ save_grade_structure_v2 ส่งมา
 *
 *  save_grade_structure_v2 เขียนคอลัมน์ที่มันรู้จักเท่านั้น การเพิ่มคอลัมน์ใหม่
 *  เข้าไปในฟังก์ชันนั้นต้องคัดลอกโค้ดทั้งก้อนมาแก้ ซึ่งเสี่ยงต่อการพลาด
 *  แยกเป็น RPC เล็ก ๆ ตัวเดียวที่หน้าจอเรียกต่อท้ายแทน ปลอดภัยกว่าและย้อนกลับง่าย
 */
CREATE OR REPLACE FUNCTION public.set_component_planned_count(
  _component_id uuid,
  _planned integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id uuid;
BEGIN
  SELECT course_id INTO v_course_id FROM public.grade_components WHERE id = _component_id;
  IF v_course_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบหมวดคะแนนนี้' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (public.is_course_instructor(v_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้หมวดคะแนนของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _planned IS NOT NULL AND (_planned <= 0 OR _planned > 200) THEN
    RAISE EXCEPTION 'จำนวนงานที่วางแผนไว้ต้องอยู่ระหว่าง 1 - 200'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.grade_components SET planned_item_count = _planned WHERE id = _component_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_component_planned_count(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_component_planned_count(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.set_component_planned_count(uuid, integer) IS
  'ตั้งจำนวนงานที่วางแผนไว้ของหมวด ส่ง NULL เพื่อกลับไปคิดจากงานที่มีอยู่จริง';
