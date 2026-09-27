-- เกณฑ์ตัดเกรด: ให้ตาราง grade_scales เป็นแหล่งความจริงเดียว
--
-- ของเดิมมีเกณฑ์ตัดเกรดอยู่สามชุดในโปรเจกต์เดียว
--   1. letterGrade() ใน src/lib/grade-data.ts  (ฮาร์ดโค้ดใน TypeScript)
--   2. grade_letter() ใน SQL                    (ฮาร์ดโค้ดใน CASE ... END)
--   3. ตาราง grade_scales                        (มีตาราง แต่ว่างเปล่า ไม่มีใครใช้)
-- สามชุดนี้แก้คนละที่ ถ้าหลักสูตรเปลี่ยนเกณฑ์จะเพี้ยนกันเอง และไม่มีชุดไหน
-- ปรับรายวิชาได้ ทั้งที่อาจารย์แต่ละคนใช้เกณฑ์ไม่เหมือนกันจริง ๆ
--
-- ของใหม่
--   - grade_scales แถวที่ course_id IS NULL = เกณฑ์เริ่มต้นของระบบ
--   - แถวที่ course_id = <รายวิชา> = เกณฑ์ที่อาจารย์กำหนดเอง ทับค่าเริ่มต้น
--   - grade_letter() อ่านจากตารางเท่านั้น ไม่มี CASE ฮาร์ดโค้ดอีก
--   - เพิ่ม grade_point เพื่อให้การคิด GPA มาจากแหล่งเดียวกันด้วย
--     (ของเดิม gradePoint() ใน TypeScript ก็ฮาร์ดโค้ดแยกอีกชุด)

ALTER TABLE public.grade_scales
  ADD COLUMN IF NOT EXISTS grade_point numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;

-- min_score ต้องอยู่ในช่วงที่คิดเป็นเปอร์เซ็นต์ได้
ALTER TABLE public.grade_scales DROP CONSTRAINT IF EXISTS grade_scales_min_score_range;
ALTER TABLE public.grade_scales
  ADD CONSTRAINT grade_scales_min_score_range
  CHECK (min_score >= 0 AND min_score <= 100);

-- ── เกณฑ์เริ่มต้นของระบบ ───────────────────────────────────────────────────
-- ต้องสร้าง unique index แบบมีเงื่อนไขก่อน INSERT
-- เพราะ UNIQUE (course_id, grade) ที่มีอยู่ใช้กับแถวของระบบไม่ได้:
-- PostgreSQL ถือว่า NULL ไม่เท่ากับ NULL แถว course_id IS NULL จึงซ้ำได้ไม่จำกัด
-- และ ON CONFLICT (course_id, grade) ก็จะไม่จับแถวเดิม ทำให้รัน migration ซ้ำ
-- แล้วได้แถวซ้ำทุกครั้ง

-- ล้างแถวของระบบที่ซ้ำอยู่ก่อน (ถ้ามี) ไม่งั้นสร้าง unique index ไม่ได้
-- ใช้ row_number() ไม่ใช้ min(id) เพราะ PostgreSQL ไม่มี aggregate min() ของ uuid
DELETE FROM public.grade_scales
 WHERE ctid IN (
   SELECT ctid FROM (
     SELECT ctid, row_number() OVER (PARTITION BY grade ORDER BY id::text) AS rn
     FROM public.grade_scales
     WHERE course_id IS NULL
   ) t WHERE t.rn > 1
 );

CREATE UNIQUE INDEX IF NOT EXISTS grade_scales_system_grade_uniq
  ON public.grade_scales (grade) WHERE course_id IS NULL;

-- ค่าเริ่มต้นตรงกับที่ฮาร์ดโค้ดไว้เดิม จึงไม่มีนักศึกษาคนไหนได้เกรดเปลี่ยน
INSERT INTO public.grade_scales (course_id, grade, min_score, grade_point, position)
VALUES
  (NULL, 'A',  80, 4.0, 1),
  (NULL, 'B+', 75, 3.5, 2),
  (NULL, 'B',  70, 3.0, 3),
  (NULL, 'C+', 65, 2.5, 4),
  (NULL, 'C',  60, 2.0, 5),
  (NULL, 'D+', 55, 1.5, 6),
  (NULL, 'D',  50, 1.0, 7),
  (NULL, 'F',   0, 0.0, 8)
ON CONFLICT (grade) WHERE course_id IS NULL DO UPDATE
  SET min_score   = EXCLUDED.min_score,
      grade_point = EXCLUDED.grade_point,
      position    = EXCLUDED.position;

-- ── ฟังก์ชันอ่านเกณฑ์ที่ "มีผลจริง" ของรายวิชาหนึ่ง ────────────────────────
-- ถ้ารายวิชากำหนดเกณฑ์เอง ใช้ของรายวิชาทั้งชุด ไม่ผสมกับค่าเริ่มต้น
-- (ผสมแล้วจะได้เกณฑ์ที่ไม่มีใครตั้งใจ เช่นรายวิชาตั้งแค่ A กับ F แล้วไปได้
--  B+ ของระบบมาแทรกกลาง)
CREATE OR REPLACE FUNCTION public.effective_grade_scale(_course_id uuid)
RETURNS TABLE (grade text, min_score numeric, grade_point numeric, is_course_specific boolean)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH own AS (
    SELECT gs.grade, gs.min_score, gs.grade_point
    FROM public.grade_scales gs
    WHERE gs.course_id = _course_id
  )
  SELECT o.grade, o.min_score, o.grade_point, true
  FROM own o
  UNION ALL
  SELECT d.grade, d.min_score, d.grade_point, false
  FROM public.grade_scales d
  WHERE d.course_id IS NULL AND NOT EXISTS (SELECT 1 FROM own)
  ORDER BY 2 DESC;
$$;

GRANT EXECUTE ON FUNCTION public.effective_grade_scale(uuid) TO authenticated;

-- ── grade_letter: อ่านจากตารางเท่านั้น ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grade_letter(_course_id uuid, _total numeric)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT s.grade
  FROM public.effective_grade_scale(_course_id) s
  WHERE _total >= s.min_score
  ORDER BY s.min_score DESC
  LIMIT 1;
$$;

-- คู่กันสำหรับการคิด GPA
CREATE OR REPLACE FUNCTION public.grade_point_of(_course_id uuid, _total numeric)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT s.grade_point
  FROM public.effective_grade_scale(_course_id) s
  WHERE _total >= s.min_score
  ORDER BY s.min_score DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.grade_point_of(uuid, numeric) TO authenticated;

-- ── บันทึกเกณฑ์ของรายวิชาทั้งชุดในครั้งเดียว ───────────────────────────────
-- ส่ง _rows เป็น [] = ล้างเกณฑ์ของรายวิชา กลับไปใช้ค่าเริ่มต้นของระบบ
CREATE OR REPLACE FUNCTION public.save_course_grade_scale(
  _course_id uuid,
  _rows jsonb,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb;
  i integer := 0;
  _before jsonb;
  _n integer;
BEGIN
  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้เกณฑ์ตัดเกรดของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('grade', grade, 'min_score', min_score,
                                      'grade_point', grade_point) ORDER BY min_score DESC)
    INTO _before
  FROM public.grade_scales WHERE course_id = _course_id;

  -- ตรวจความสมเหตุสมผลก่อนเขียน
  SELECT count(*) INTO _n FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb));
  IF _n > 0 THEN
    IF _n < 2 THEN
      RAISE EXCEPTION 'เกณฑ์ตัดเกรดต้องมีอย่างน้อย 2 ระดับ' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(_rows) e
      WHERE btrim(COALESCE(e->>'grade','')) = ''
         OR (e->>'min_score') IS NULL
         OR (e->>'min_score')::numeric < 0
         OR (e->>'min_score')::numeric > 100
    ) THEN
      RAISE EXCEPTION 'ทุกระดับต้องมีชื่อเกรด และคะแนนขั้นต่ำต้องอยู่ระหว่าง 0-100'
        USING ERRCODE = 'check_violation';
    END IF;
    -- ต้องมีระดับที่เริ่มจาก 0 ไม่งั้นนักศึกษาคะแนนต่ำจะไม่ได้เกรดอะไรเลย
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(_rows) e WHERE (e->>'min_score')::numeric = 0
    ) THEN
      RAISE EXCEPTION 'ต้องมีเกรดที่คะแนนขั้นต่ำเป็น 0 (เกรดต่ำสุด) ไม่งั้นนักศึกษาที่คะแนนต่ำจะไม่ได้เกรด'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  DELETE FROM public.grade_scales WHERE course_id = _course_id;

  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb)) LOOP
    i := i + 1;
    INSERT INTO public.grade_scales (course_id, grade, min_score, grade_point, position)
    VALUES (_course_id, btrim(r->>'grade'), (r->>'min_score')::numeric,
            COALESCE((r->>'grade_point')::numeric, 0), i);
  END LOOP;

  PERFORM public.log_audit_event(
    'grade_scale.update', 'course', _course_id::text,
    CASE WHEN i = 0 THEN 'ล้างเกณฑ์ตัดเกรดของรายวิชา กลับไปใช้ค่าเริ่มต้นของระบบ'
         ELSE 'ตั้งเกณฑ์ตัดเกรดของรายวิชา ' || i::text || ' ระดับ' END,
    _before, _rows, _reason);
END;
$$;

REVOKE ALL ON FUNCTION public.save_course_grade_scale(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_course_grade_scale(uuid, jsonb, text) TO authenticated;
