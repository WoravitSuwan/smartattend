-- ═══════════════════════════════════════════════════════════════════════════
--  โครงสร้างคะแนนสามระดับ: รายวิชา → หมวดคะแนน → รายการคะแนน → คะแนนรายคน
--
--  ต่อยอดจากของเดิม ไม่สร้างสคีมาซ้อน
--    grade_components  มีอยู่แล้ว (kind, weight_percent, is_final_exam,
--                      score_mode, late_credit, excused_credit, position)
--    grade_items       มี component_id, position, source อยู่แล้ว
--
--  ที่เพิ่มในไฟล์นี้
--    grade_components.calc_mode        proportional | weighted_items
--    grade_components.drop_lowest      ตัดรายการที่ได้คะแนนต่ำสุดออกกี่รายการ
--    grade_components.credit_on_time / credit_late / credit_excused /
--                     credit_absent    เกณฑ์คะแนนเข้าเรียนที่อาจารย์ตั้งเองได้
--    grade_items.weight_in_component   น้ำหนักย่อย ใช้เฉพาะโหมด weighted_items
--    grade_structure_templates         แม่แบบส่วนตัวของอาจารย์
--
--  ค่าเริ่มต้นตามที่เจ้าของงานกำหนด (ทำเป็นค่าตั้งได้ ไม่ฮาร์ดโค้ด)
--    1. max_score เก็บเป็นคะแนนดิบเสมอ ให้โหมดของหมวดเป็นตัวแปลงเป็นเปอร์เซ็นต์
--    2. ไม่รองรับหมวดย่อยซ้อนหมวด — V1/V2 แตกเป็นสองรายการในหมวดเดียวกัน
--       (จึงต้องมีโหมด weighted_items ให้แต่ละรายการถือน้ำหนักย่อยของตัวเอง)
--    3. จิตพิสัยใช้ score_mode = 'manual' คือกรอกเอง
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. คอลัมน์ใหม่ (เพิ่มเท่านั้น ไม่ DROP อะไรที่มีข้อมูล)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.grade_components
  ADD COLUMN IF NOT EXISTS calc_mode text NOT NULL DEFAULT 'proportional',
  ADD COLUMN IF NOT EXISTS drop_lowest integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_on_time numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS credit_late numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS credit_excused numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS credit_absent numeric NOT NULL DEFAULT 0.0;

ALTER TABLE public.grade_components DROP CONSTRAINT IF EXISTS grade_components_calc_mode_check;
ALTER TABLE public.grade_components
  ADD CONSTRAINT grade_components_calc_mode_check
  CHECK (calc_mode IN ('proportional', 'weighted_items'));

ALTER TABLE public.grade_components DROP CONSTRAINT IF EXISTS grade_components_drop_lowest_check;
ALTER TABLE public.grade_components
  ADD CONSTRAINT grade_components_drop_lowest_check
  CHECK (drop_lowest >= 0 AND drop_lowest <= 20);

ALTER TABLE public.grade_components DROP CONSTRAINT IF EXISTS grade_components_credit_range_check;
ALTER TABLE public.grade_components
  ADD CONSTRAINT grade_components_credit_range_check
  CHECK (credit_on_time BETWEEN 0 AND 1 AND credit_late BETWEEN 0 AND 1
     AND credit_excused BETWEEN 0 AND 1 AND credit_absent BETWEEN 0 AND 1);

-- ย้ายค่าจากคอลัมน์เดิมมาคอลัมน์ใหม่ครั้งเดียว
-- late_credit / excused_credit เดิมยังอยู่ (ห้ามลบคอลัมน์ที่มีข้อมูล) แต่โค้ด
-- จะเลิกอ่านตั้งแต่นี้ไป และลบได้ในเฟสถัดไปเมื่อยืนยันว่าไม่มีใครอ่านแล้ว
UPDATE public.grade_components
   SET credit_late    = COALESCE(late_credit, credit_late),
       credit_excused = COALESCE(excused_credit, credit_excused)
 WHERE late_credit IS NOT NULL OR excused_credit IS NOT NULL;

ALTER TABLE public.grade_items
  ADD COLUMN IF NOT EXISTS weight_in_component numeric NOT NULL DEFAULT 0;

ALTER TABLE public.grade_items DROP CONSTRAINT IF EXISTS grade_items_weight_in_component_check;
ALTER TABLE public.grade_items
  ADD CONSTRAINT grade_items_weight_in_component_check
  CHECK (weight_in_component >= 0 AND weight_in_component <= 100);

COMMENT ON COLUMN public.grade_items.max_score IS
  'คะแนนดิบเต็มของรายการ (ไม่ใช่เปอร์เซ็นต์) การแปลงเป็นเปอร์เซ็นต์เป็นหน้าที่ของ calc_mode ของหมวด';
COMMENT ON COLUMN public.grade_items.weight IS
  'เลิกใช้แล้ว — น้ำหนักอยู่ที่ grade_components.weight_percent (หมวด) และ grade_items.weight_in_component (รายการย่อยในโหมด weighted_items) คงคอลัมน์ไว้เพื่อไม่ให้ข้อมูลเก่าหาย จะลบในเฟสถัดไป';
COMMENT ON COLUMN public.grade_components.late_credit IS
  'เลิกใช้แล้ว — ใช้ credit_late แทน';
COMMENT ON COLUMN public.grade_components.excused_credit IS
  'เลิกใช้แล้ว — ใช้ credit_excused แทน';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. ย้ายข้อมูลเดิมให้ทุกรายการมีหมวด
--    migration 20260926 ย้ายไปแล้วรอบหนึ่ง แต่รายการที่สร้างหลังจากนั้นผ่าน
--    save_grade_item ยังไม่มี component_id (RPC นั้นไม่ได้ตั้งให้)
--    รอบนี้ครอบทุกแถวที่ยังค้าง และย้ายน้ำหนักเดิมขึ้นไปที่หมวด
-- ───────────────────────────────────────────────────────────────────────────
DO $migrate$
DECLARE
  rec record;
  v_component_id uuid;
  v_name text;
BEGIN
  FOR rec IN
    SELECT course_id, category, sum(weight) AS w, count(*) AS n
    FROM public.grade_items
    WHERE component_id IS NULL
    GROUP BY course_id, category
  LOOP
    v_name := CASE rec.category
                WHEN 'attendance' THEN 'คะแนนการเข้าเรียน'
                WHEN 'assignment' THEN 'งานที่มอบหมาย'
                WHEN 'midterm'    THEN 'สอบกลางภาค'
                WHEN 'final'      THEN 'สอบปลายภาค'
                ELSE 'อื่น ๆ'
              END;

    -- หมวดชื่อนี้อาจมีอยู่แล้วจาก migration รอบก่อน ให้ใช้ของเดิมและบวกน้ำหนักเข้าไป
    SELECT id INTO v_component_id
    FROM public.grade_components
    WHERE course_id = rec.course_id AND name = v_name;

    IF v_component_id IS NULL THEN
      INSERT INTO public.grade_components
        (course_id, name, kind, weight_percent, is_final_exam, score_mode,
         calc_mode, credit_late, credit_excused)
      VALUES (
        rec.course_id, v_name, rec.category,
        LEAST(COALESCE(rec.w, 0), 100),
        rec.category = 'final',
        CASE rec.category WHEN 'attendance' THEN 'auto_attendance' ELSE 'manual' END,
        'proportional', 0.5, 1.0)
      RETURNING id INTO v_component_id;
    ELSE
      UPDATE public.grade_components
         SET weight_percent = LEAST(weight_percent + COALESCE(rec.w, 0), 100)
       WHERE id = v_component_id;
    END IF;

    UPDATE public.grade_items
       SET component_id = v_component_id
     WHERE course_id = rec.course_id AND category = rec.category AND component_id IS NULL;
  END LOOP;
END
$migrate$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. สูตรคำนวณคะแนนของหมวด — แหล่งความจริงเดียว อยู่ในฐานข้อมูล
--
--    คืน jsonb {earned, max_points, graded_items, total_items, dropped,
--               has_any_score}
--    earned มีหน่วยเป็น "คะแนนของวิชา" (0..weight_percent)
--    max_points คือน้ำหนักของส่วนที่ "ตรวจแล้ว" — ใช้เป็นตัวหารตอนคิดเกรด
--
--    กฎที่ต้องไม่พลาด
--      - รายการที่ยังไม่ตรวจ (score IS NULL) ไม่ถูกนับเป็นศูนย์ และไม่ถูกนับ
--        ในตัวหาร  null = ยังไม่ตรวจ, 0 = ตรวจแล้วได้ศูนย์ แยกกันเด็ดขาด
--      - drop_lowest ตัดรายการที่ได้สัดส่วนคะแนนต่ำสุดออก นับเฉพาะรายการที่
--        ตรวจแล้ว และไม่ตัดจนไม่เหลือรายการเลย
--      - รายการที่ max_score <= 0 ใช้คำนวณไม่ได้ ข้ามทั้งตัวตั้งและตัวหาร
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
  -- รายการของหมวด พร้อมสัดส่วนคะแนนของนักศึกษาคนนี้
  -- ข้ามรายการที่ max_score ใช้คำนวณไม่ได้ (ว่าง/0/ติดลบ) ทั้งตัวตั้งและตัวหาร
  rows AS (
    SELECT gi.id,
           gi.position,
           gi.max_score,
           CASE WHEN c.calc_mode = 'weighted_items'
                THEN COALESCE(gi.weight_in_component, 0) ELSE 0 END AS w,
           sg.score,
           -- null = ยังไม่ตรวจ (ไม่ใช่ 0) · 0 = ตรวจแล้วได้ศูนย์
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
  -- drop_lowest ตัดรายการที่ได้สัดส่วนต่ำสุด นับเฉพาะรายการที่ตรวจแล้ว
  -- และต้องเหลืออย่างน้อยหนึ่งรายการ ไม่งั้นหมวดจะไม่มีคะแนนเลย
  dropn AS (
    SELECT LEAST(
             COALESCE((SELECT drop_lowest FROM c), 0),
             GREATEST((SELECT graded_items FROM counts) - 1, 0)
           ) AS d
  ),
  dropped_ids AS (
    -- เสมอกันให้ตัดตามลำดับที่อาจารย์จัดไว้ (position) ก่อน แล้วจึง id
    -- ถ้าเรียงด้วย id อย่างเดียว ผลจะขึ้นกับ uuid ที่สุ่มมา อธิบายให้นักศึกษาไม่ได้
    SELECT id FROM graded
     ORDER BY ratio ASC, position ASC, id ASC
     LIMIT (SELECT d FROM dropn)
  ),
  kept AS (
    SELECT * FROM graded WHERE id NOT IN (SELECT id FROM dropped_ids)
  ),
  agg AS (
    SELECT
      -- โหมด weighted_items
      COALESCE((SELECT sum(ratio * w) FROM kept), 0)                 AS wi_earned,
      COALESCE((SELECT sum(w) FROM kept), 0)                         AS wi_w_graded,
      COALESCE((SELECT sum(w) FROM rows
                 WHERE id NOT IN (SELECT id FROM dropped_ids)), 0)   AS wi_w_all,
      -- โหมด proportional
      COALESCE((SELECT sum(score) FROM kept), 0)                     AS pr_earned_raw,
      COALESCE((SELECT sum(max_score) FROM kept), 0)                 AS pr_max_graded,
      COALESCE((SELECT sum(max_score) FROM rows
                 WHERE id NOT IN (SELECT id FROM dropped_ids)), 0)   AS pr_max_all
  )
  SELECT CASE
    WHEN (SELECT id FROM c) IS NULL OR (SELECT graded_items FROM counts) = 0 THEN
      jsonb_build_object(
        'earned', 0, 'max_points', 0,
        'graded_items', COALESCE((SELECT graded_items FROM counts), 0),
        'total_items', COALESCE((SELECT total_items FROM counts), 0),
        'dropped', 0, 'has_any_score', false)
    WHEN (SELECT calc_mode FROM c) = 'weighted_items' THEN
      jsonb_build_object(
        'earned', round(a.wi_earned / 100.0 * (SELECT weight_percent FROM c), 6),
        'max_points', round(
          CASE WHEN a.wi_w_all > 0
               THEN a.wi_w_graded / 100.0 * (SELECT weight_percent FROM c)
               ELSE 0 END, 6),
        'graded_items', (SELECT count(*) FROM kept),
        'total_items', (SELECT total_items FROM counts),
        'dropped', (SELECT d FROM dropn), 'has_any_score', true)
    ELSE
      jsonb_build_object(
        -- ตัวหารของ earned คือคะแนนเต็ม "ทั้งหมวด" (หักรายการที่ถูก drop) ไม่ใช่
        -- คะแนนเต็มของส่วนที่ตรวจแล้ว เพื่อให้ earned กับ max_points อยู่สเกล
        -- เดียวกัน จะอ่านว่า "ได้ X จาก Y" ได้ตรง ๆ และ earned ÷ max_points
        -- เท่ากับสัดส่วนคะแนนของงานที่ตรวจแล้วพอดี
        -- (ถ้าหารด้วยคะแนนเต็มของส่วนที่ตรวจแล้ว จะได้ earned=30 max_points=3
        --  ซึ่งอ่านว่า "ได้ 30 จาก 3" ไม่มีความหมาย)
        'earned', round(
          CASE WHEN a.pr_max_all > 0
               THEN a.pr_earned_raw / a.pr_max_all * (SELECT weight_percent FROM c)
               ELSE 0 END, 6),
        'max_points', round(
          CASE WHEN a.pr_max_all > 0
               THEN a.pr_max_graded / a.pr_max_all * (SELECT weight_percent FROM c)
               ELSE 0 END, 6),
        'graded_items', (SELECT count(*) FROM kept),
        'total_items', (SELECT total_items FROM counts),
        'dropped', (SELECT d FROM dropn), 'has_any_score', true)
  END
  FROM agg a;
$$;

GRANT EXECUTE ON FUNCTION public.component_score(uuid, uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. ตรวจน้ำหนักย่อยในหมวดโหมด weighted_items ต้องรวม 100
--    deferrable initially deferred เพื่อให้แก้ทั้งชุดในทรานแซกชันเดียวได้
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_component_item_weights()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_component_id uuid := COALESCE(NEW.component_id, OLD.component_id);
  v_mode text;
  v_total numeric;
  v_count integer;
BEGIN
  IF v_component_id IS NULL THEN RETURN NULL; END IF;

  SELECT calc_mode INTO v_mode FROM public.grade_components WHERE id = v_component_id;
  IF v_mode IS DISTINCT FROM 'weighted_items' THEN RETURN NULL; END IF;

  SELECT count(*), COALESCE(sum(weight_in_component), 0)
    INTO v_count, v_total
  FROM public.grade_items WHERE component_id = v_component_id;

  IF v_count > 0 AND round(v_total, 2) <> 100 THEN
    RAISE EXCEPTION 'หมวดที่คิดคะแนนแบบน้ำหนักย่อย ต้องมีน้ำหนักย่อยรวมเท่ากับ 100 พอดี (ขณะนี้ %)', v_total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_component_item_weights ON public.grade_items;
CREATE CONSTRAINT TRIGGER trg_component_item_weights
  AFTER INSERT OR UPDATE OR DELETE ON public.grade_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_component_item_weights();

-- ───────────────────────────────────────────────────────────────────────────
-- 5. บันทึกโครงสร้างคะแนนทั้งชุดผ่าน RPC เดียว
--
--    แก้ข้อบกพร่องของ save_grade_structure เดิมสองข้อ
--      1. เดิม DELETE หมวดที่ไม่ได้ส่งมาทุกครั้ง ถ้าหน้าจอส่งมาไม่ครบ (โหลดไม่ทัน
--         หรือส่งแค่หมวดที่แก้) หมวดที่เหลือจะถูกลบพร้อมคะแนนของนักศึกษาทั้งหมด
--         ผ่าน ON DELETE CASCADE โดยไม่มีการเตือนและกู้ไม่ได้
--         รอบนี้ต้องส่ง _delete_missing = true มาอย่างชัดเจนจึงจะลบ และลบได้
--         เฉพาะหมวดที่ "ยังไม่มีคะแนนของนักศึกษา" เท่านั้น
--      2. เดิมจับคู่หมวดด้วยชื่อ (ON CONFLICT (course_id, name)) การเปลี่ยนชื่อ
--         หมวดจึงกลายเป็นสร้างหมวดใหม่ + ลบหมวดเก่าพร้อมคะแนน
--         รอบนี้จับคู่ด้วย id ถ้าส่งมา
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_grade_structure_v2(
  _course_id uuid,
  _components jsonb,
  _delete_missing boolean DEFAULT false,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c jsonb;
  i integer := 0;
  v_keep uuid[] := '{}';
  v_id uuid;
  v_before jsonb;
  v_removed integer := 0;
  v_blocked text[] := '{}';
  v_total numeric;
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้โครงสร้างคะแนนของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _components IS NULL OR jsonb_typeof(_components) <> 'array' THEN
    RAISE EXCEPTION 'รูปแบบข้อมูลโครงสร้างคะแนนไม่ถูกต้อง'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'id', id, 'name', name, 'kind', kind, 'weight_percent', weight_percent,
           'calc_mode', calc_mode, 'drop_lowest', drop_lowest,
           'is_final_exam', is_final_exam, 'score_mode', score_mode)
         ORDER BY position)
    INTO v_before
  FROM public.grade_components WHERE course_id = _course_id;

  -- ── ตรวจทุกหมวดก่อนเขียน ─────────────────────────────────────────────────
  FOR c IN SELECT * FROM jsonb_array_elements(_components) LOOP
    IF btrim(COALESCE(c->>'name', '')) = '' THEN
      RAISE EXCEPTION 'ทุกหมวดต้องมีชื่อ' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE((c->>'weight_percent')::numeric, -1) < 0
       OR (c->>'weight_percent')::numeric > 100 THEN
      RAISE EXCEPTION 'น้ำหนักของหมวด "%" ต้องอยู่ระหว่าง 0 - 100', c->>'name'
        USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(c->>'calc_mode', 'proportional') NOT IN ('proportional','weighted_items') THEN
      RAISE EXCEPTION 'โหมดคำนวณของหมวด "%" ไม่ถูกต้อง', c->>'name'
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- ── เขียน ────────────────────────────────────────────────────────────────
  FOR c IN SELECT * FROM jsonb_array_elements(_components) LOOP
    i := i + 1;
    v_id := NULLIF(c->>'id', '')::uuid;

    IF v_id IS NOT NULL THEN
      -- จับคู่ด้วย id จึงเปลี่ยนชื่อหมวดได้โดยคะแนนไม่หาย
      UPDATE public.grade_components SET
        name           = btrim(c->>'name'),
        kind           = COALESCE(c->>'kind', kind),
        weight_percent = COALESCE((c->>'weight_percent')::numeric, weight_percent),
        calc_mode      = COALESCE(c->>'calc_mode', calc_mode),
        drop_lowest    = COALESCE((c->>'drop_lowest')::integer, drop_lowest),
        is_final_exam  = COALESCE((c->>'is_final_exam')::boolean, is_final_exam),
        score_mode     = COALESCE(c->>'score_mode', score_mode),
        credit_on_time = COALESCE((c->>'credit_on_time')::numeric, credit_on_time),
        credit_late    = COALESCE((c->>'credit_late')::numeric, credit_late),
        credit_excused = COALESCE((c->>'credit_excused')::numeric, credit_excused),
        credit_absent  = COALESCE((c->>'credit_absent')::numeric, credit_absent),
        position       = i
      WHERE id = v_id AND course_id = _course_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'ไม่พบหมวด "%" ในรายวิชานี้ (อาจถูกลบไปแล้ว)', c->>'name'
          USING ERRCODE = 'no_data_found';
      END IF;
    ELSE
      INSERT INTO public.grade_components
        (course_id, name, kind, weight_percent, calc_mode, drop_lowest,
         is_final_exam, score_mode, credit_on_time, credit_late, credit_excused,
         credit_absent, position)
      VALUES (
        _course_id, btrim(c->>'name'), COALESCE(c->>'kind', 'other'),
        COALESCE((c->>'weight_percent')::numeric, 0),
        COALESCE(c->>'calc_mode', 'proportional'),
        COALESCE((c->>'drop_lowest')::integer, 0),
        COALESCE((c->>'is_final_exam')::boolean, COALESCE(c->>'kind','') = 'final'),
        COALESCE(c->>'score_mode', 'manual'),
        COALESCE((c->>'credit_on_time')::numeric, 1.0),
        COALESCE((c->>'credit_late')::numeric, 0.5),
        COALESCE((c->>'credit_excused')::numeric, 1.0),
        COALESCE((c->>'credit_absent')::numeric, 0.0),
        i)
      ON CONFLICT (course_id, name) DO UPDATE SET
        kind = EXCLUDED.kind, weight_percent = EXCLUDED.weight_percent,
        calc_mode = EXCLUDED.calc_mode, drop_lowest = EXCLUDED.drop_lowest,
        is_final_exam = EXCLUDED.is_final_exam, score_mode = EXCLUDED.score_mode,
        credit_on_time = EXCLUDED.credit_on_time, credit_late = EXCLUDED.credit_late,
        credit_excused = EXCLUDED.credit_excused, credit_absent = EXCLUDED.credit_absent,
        position = EXCLUDED.position
      RETURNING id INTO v_id;
    END IF;

    v_keep := v_keep || v_id;
  END LOOP;

  -- ── ลบหมวดที่ไม่ได้ส่งมา (ต้องขอมาอย่างชัดเจน และเฉพาะหมวดที่ยังไม่มีคะแนน)
  IF _delete_missing THEN
    SELECT COALESCE(array_agg(gc.name), '{}') INTO v_blocked
    FROM public.grade_components gc
    WHERE gc.course_id = _course_id
      AND NOT (gc.id = ANY(v_keep))
      AND EXISTS (
        SELECT 1 FROM public.grade_items gi
        JOIN public.student_grades sg ON sg.grade_item_id = gi.id AND sg.score IS NOT NULL
        WHERE gi.component_id = gc.id
      );

    IF array_length(v_blocked, 1) > 0 THEN
      RAISE EXCEPTION 'ลบหมวดที่มีคะแนนของนักศึกษาอยู่ไม่ได้: % (ให้ลบรายการคะแนนในหมวดนั้นก่อน)',
        array_to_string(v_blocked, ', ')
        USING ERRCODE = 'check_violation';
    END IF;

    DELETE FROM public.grade_components
     WHERE course_id = _course_id AND NOT (id = ANY(v_keep));
    GET DIAGNOSTICS v_removed = ROW_COUNT;
  END IF;

  SELECT COALESCE(sum(weight_percent), 0) INTO v_total
  FROM public.grade_components WHERE course_id = _course_id;

  PERFORM public.log_audit_event(
    'grade_structure.save', 'course', _course_id::text,
    'บันทึกโครงสร้างคะแนน ' || i::text || ' หมวด'
      || CASE WHEN v_removed > 0 THEN ' · ลบ ' || v_removed::text || ' หมวด' ELSE '' END
      || ' · น้ำหนักรวม ' || v_total::text || '%',
    v_before, _components, _reason);

  RETURN jsonb_build_object('saved', i, 'removed', v_removed, 'total_weight', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.save_grade_structure_v2(uuid, jsonb, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_grade_structure_v2(uuid, jsonb, boolean, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. คัดลอกโครงสร้างจากรายวิชาอื่นของอาจารย์คนเดียวกัน
--    คัดลอก "โครงสร้างเท่านั้น" ไม่คัดลอกคะแนนของนักศึกษา และไม่คัดลอกรายการ
--    ที่มาจากงานที่มอบหมาย/การเข้าเรียน (source <> 'manual') เพราะรายการเหล่านั้น
--    ถูกสร้างอัตโนมัติจากงานของรายวิชาต้นทาง ซึ่งไม่มีในรายวิชาปลายทาง
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.copy_grade_structure(
  _from_course_id uuid,
  _to_course_id uuid,
  _include_items boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_new_component uuid;
  v_components integer := 0;
  v_items integer := 0;
BEGIN
  -- ต้องเป็นผู้สอนของ "ทั้งสอง" รายวิชา ไม่งั้นจะดูโครงสร้างวิชาคนอื่นได้
  IF NOT (public.is_course_instructor(_from_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์อ่านโครงสร้างคะแนนของรายวิชาต้นทาง'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (public.is_course_instructor(_to_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้โครงสร้างคะแนนของรายวิชาปลายทาง'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _from_course_id = _to_course_id THEN
    RAISE EXCEPTION 'รายวิชาต้นทางและปลายทางเป็นวิชาเดียวกัน' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM public.grade_components WHERE course_id = _to_course_id) THEN
    RAISE EXCEPTION 'รายวิชาปลายทางมีโครงสร้างคะแนนอยู่แล้ว ให้ลบหมวดเดิมก่อนคัดลอก'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR rec IN
    SELECT * FROM public.grade_components WHERE course_id = _from_course_id ORDER BY position
  LOOP
    INSERT INTO public.grade_components
      (course_id, name, kind, weight_percent, calc_mode, drop_lowest, is_final_exam,
       score_mode, credit_on_time, credit_late, credit_excused, credit_absent, position)
    VALUES (_to_course_id, rec.name, rec.kind, rec.weight_percent, rec.calc_mode,
            rec.drop_lowest, rec.is_final_exam, rec.score_mode, rec.credit_on_time,
            rec.credit_late, rec.credit_excused, rec.credit_absent, rec.position)
    RETURNING id INTO v_new_component;
    v_components := v_components + 1;

    IF _include_items THEN
      INSERT INTO public.grade_items
        (course_id, component_id, name, category, max_score, weight,
         weight_in_component, position, source)
      SELECT _to_course_id, v_new_component, gi.name, gi.category, gi.max_score, 0,
             gi.weight_in_component, gi.position, 'manual'
      FROM public.grade_items gi
      WHERE gi.component_id = rec.id AND gi.source = 'manual';
      v_items := v_items + (SELECT count(*) FROM public.grade_items
                             WHERE component_id = v_new_component);
    END IF;
  END LOOP;

  PERFORM public.log_audit_event(
    'grade_structure.copy', 'course', _to_course_id::text,
    'คัดลอกโครงสร้างคะแนน ' || v_components::text || ' หมวด ' || v_items::text
      || ' รายการ จากรายวิชา ' || _from_course_id::text || ' (ไม่คัดลอกคะแนนนักศึกษา)',
    NULL::jsonb, NULL::jsonb, NULL::text);

  RETURN jsonb_build_object('components', v_components, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.copy_grade_structure(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_grade_structure(uuid, uuid, boolean) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. แม่แบบส่วนตัวของอาจารย์ เพื่อใช้เทอมถัดไป
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.grade_structure_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);

ALTER TABLE public.grade_structure_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage own grade structure templates"
  ON public.grade_structure_templates;
CREATE POLICY "Owners manage own grade structure templates"
  ON public.grade_structure_templates FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.grade_structure_templates TO authenticated;
GRANT ALL ON public.grade_structure_templates TO service_role;

-- บันทึกโครงสร้างของรายวิชาเป็นแม่แบบ (โครงสร้างเท่านั้น ไม่มีคะแนน)
CREATE OR REPLACE FUNCTION public.save_grade_structure_template(
  _course_id uuid,
  _name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _payload jsonb;
  _id uuid;
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์อ่านโครงสร้างคะแนนของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF btrim(COALESCE(_name, '')) = '' THEN
    RAISE EXCEPTION 'กรุณาตั้งชื่อแม่แบบ' USING ERRCODE = 'check_violation';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'name', gc.name, 'kind', gc.kind, 'weight_percent', gc.weight_percent,
           'calc_mode', gc.calc_mode, 'drop_lowest', gc.drop_lowest,
           'is_final_exam', gc.is_final_exam, 'score_mode', gc.score_mode,
           'credit_on_time', gc.credit_on_time, 'credit_late', gc.credit_late,
           'credit_excused', gc.credit_excused, 'credit_absent', gc.credit_absent,
           'items', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'name', gi.name, 'category', gi.category,
                      'max_score', gi.max_score,
                      'weight_in_component', gi.weight_in_component)
                    ORDER BY gi.position)
             FROM public.grade_items gi
             WHERE gi.component_id = gc.id AND gi.source = 'manual'), '[]'::jsonb))
         ORDER BY gc.position)
    INTO _payload
  FROM public.grade_components gc
  WHERE gc.course_id = _course_id;

  IF _payload IS NULL OR jsonb_array_length(_payload) = 0 THEN
    RAISE EXCEPTION 'รายวิชานี้ยังไม่มีโครงสร้างคะแนนให้บันทึกเป็นแม่แบบ'
      USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.grade_structure_templates (owner_id, name, payload)
  VALUES (auth.uid(), btrim(_name), _payload)
  ON CONFLICT (owner_id, name) DO UPDATE SET payload = EXCLUDED.payload
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_grade_structure_template(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_grade_structure_template(uuid, text) TO authenticated;

-- นำแม่แบบมาใช้กับรายวิชา
CREATE OR REPLACE FUNCTION public.apply_grade_structure_template(
  _template_id uuid,
  _course_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _payload jsonb;
  c jsonb;
  it jsonb;
  i integer := 0;
  j integer;
  v_component uuid;
  v_items integer := 0;
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้โครงสร้างคะแนนของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT payload INTO _payload
  FROM public.grade_structure_templates
  WHERE id = _template_id AND owner_id = auth.uid();
  IF _payload IS NULL THEN
    RAISE EXCEPTION 'ไม่พบแม่แบบนี้' USING ERRCODE = 'no_data_found';
  END IF;

  IF EXISTS (SELECT 1 FROM public.grade_components WHERE course_id = _course_id) THEN
    RAISE EXCEPTION 'รายวิชานี้มีโครงสร้างคะแนนอยู่แล้ว ให้ลบหมวดเดิมก่อนใช้แม่แบบ'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR c IN SELECT * FROM jsonb_array_elements(_payload) LOOP
    i := i + 1;
    INSERT INTO public.grade_components
      (course_id, name, kind, weight_percent, calc_mode, drop_lowest, is_final_exam,
       score_mode, credit_on_time, credit_late, credit_excused, credit_absent, position)
    VALUES (_course_id, c->>'name', COALESCE(c->>'kind','other'),
            COALESCE((c->>'weight_percent')::numeric, 0),
            COALESCE(c->>'calc_mode','proportional'),
            COALESCE((c->>'drop_lowest')::integer, 0),
            COALESCE((c->>'is_final_exam')::boolean, false),
            COALESCE(c->>'score_mode','manual'),
            COALESCE((c->>'credit_on_time')::numeric, 1.0),
            COALESCE((c->>'credit_late')::numeric, 0.5),
            COALESCE((c->>'credit_excused')::numeric, 1.0),
            COALESCE((c->>'credit_absent')::numeric, 0.0),
            i)
    RETURNING id INTO v_component;

    j := 0;
    FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(c->'items', '[]'::jsonb)) LOOP
      j := j + 1;
      INSERT INTO public.grade_items
        (course_id, component_id, name, category, max_score, weight,
         weight_in_component, position, source)
      VALUES (_course_id, v_component, it->>'name',
              COALESCE(it->>'category','other'),
              COALESCE((it->>'max_score')::numeric, 100), 0,
              COALESCE((it->>'weight_in_component')::numeric, 0), j, 'manual');
      v_items := v_items + 1;
    END LOOP;
  END LOOP;

  PERFORM public.log_audit_event(
    'grade_structure.template_apply', 'course', _course_id::text,
    'ใช้แม่แบบโครงสร้างคะแนน ' || i::text || ' หมวด ' || v_items::text || ' รายการ',
    NULL::jsonb, _payload, NULL::text);

  RETURN jsonb_build_object('components', i, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_grade_structure_template(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_grade_structure_template(uuid, uuid) TO authenticated;
