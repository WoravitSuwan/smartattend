-- บังคับเพดานคะแนนที่ฐานข้อมูล: ปฏิเสธคะแนนติดลบและคะแนนเกินคะแนนเต็ม
--
-- ของเดิม
--   ช่องกรอกมีแอตทริบิวต์ max ของ <input type="number"> ซึ่งไม่ได้ห้ามพิมพ์หรือ
--   วางค่าเกิน มันแค่ทำให้ form invalid ซึ่งหน้านี้ไม่ได้ submit เป็น form
--   และ RPC upsert_student_grade ไม่ได้ตรวจเลย ใครยิง REST ตรงด้วย token
--   ของอาจารย์ก็ใส่ 9999 หรือ -50 ได้
--
--   migration 20260927110000 เคยแก้เป็นการ clamp เงียบ ๆ ซึ่งยังไม่ดีพอ
--   เพราะคะแนนที่อาจารย์กรอกกับคะแนนที่บันทึกไม่ตรงกันโดยอาจารย์ไม่รู้
--   รอบนี้เปลี่ยนเป็น "ปฏิเสธพร้อมข้อความที่อ่านรู้เรื่อง" ตามที่กำหนด
--
-- สองชั้น
--   1. CHECK constraint บน student_grades กันค่าติดลบและ NaN ได้ในตัว
--      (เพดานอ้างอิง grade_items.max_score ของอีกตารางจึงทำเป็น CHECK ไม่ได้)
--   2. RPC ตรวจเทียบ max_score ของหัวข้อนั้นและ RAISE ข้อความภาษาไทย

-- ── 1. CHECK constraint ────────────────────────────────────────────────────
-- ล้างค่าที่ใช้ไม่ได้ก่อน ไม่งั้น ADD CONSTRAINT จะล้มทั้ง migration
-- (NaN ทำให้ทุกการเปรียบเทียบเพี้ยน จึงต้องออกไปด้วย)
UPDATE public.student_grades
   SET score = NULL
 WHERE score IS NOT NULL AND (score < 0 OR score = 'NaN'::numeric);

ALTER TABLE public.student_grades
  DROP CONSTRAINT IF EXISTS student_grades_score_nonnegative;
ALTER TABLE public.student_grades
  ADD CONSTRAINT student_grades_score_nonnegative
  CHECK (score IS NULL OR (score >= 0 AND score <> 'NaN'::numeric));

-- ── 2. RPC: ปฏิเสธแทนการ clamp ─────────────────────────────────────────────
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
    RAISE EXCEPTION 'ไม่พบหัวข้อคะแนนนี้ (อาจถูกลบไปแล้ว)'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (public.is_course_instructor(_course_id, auth.uid())
          OR internal.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้คะแนนของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── ตรวจช่วงคะแนน ────────────────────────────────────────────────────────
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
        _item_name, COALESCE(_max_score::text, 'ว่าง')
        USING ERRCODE = 'check_violation';
    END IF;
    IF _score > _max_score THEN
      RAISE EXCEPTION 'คะแนนเกินคะแนนเต็ม — หัวข้อ "%" เต็ม % แต่ได้รับ %',
        _item_name, _max_score, _score
        USING ERRCODE = 'check_violation';
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

-- save_grade_item ก็ต้องไม่ปล่อยให้คะแนนเดิมค้างเกินเพดานใหม่
-- (migration 20260927110000 clamp ให้แล้ว คงพฤติกรรมนั้นไว้เพราะเป็นการแก้
--  ข้อมูลที่ "เคยถูกต้อง" ให้เข้ากรอบใหม่ ไม่ใช่การรับค่าที่ผิดเข้ามาใหม่
--  และมี audit log ทุกแถว — ข้อ 2.4 จะให้อาจารย์เลือกวิธีปรับเองได้)
