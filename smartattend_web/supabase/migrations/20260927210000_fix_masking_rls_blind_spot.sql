-- ═══════════════════════════════════════════════════════════════════════════
--  แก้ช่องโหว่: นโยบาย RLS ของ grade_items ทำให้นโยบายของ student_grades ตาบอด
--
--  อาการ
--    นักศึกษายิง REST ตรงเข้า /rest/v1/student_grades แล้ว "เห็นคะแนนสอบปลายภาค"
--    ก่อนอาจารย์ประกาศผล
--
--  สาเหตุ
--    นโยบาย "Students view own grades" ตรวจว่าแถวเป็นคะแนนปลายภาคหรือไม่ ด้วย
--
--      NOT EXISTS (SELECT 1 FROM grade_items gi
--                  JOIN courses c ...
--                  LEFT JOIN grade_components gc ...
--                  WHERE gi.id = student_grades.grade_item_id
--                    AND NOT c.final_grade_published
--                    AND (gi.category = 'final' OR gc.is_final_exam))
--
--    แต่ subquery ที่อยู่ในนิพจน์ USING ของนโยบาย **ถูก RLS ของตารางที่มัน
--    อ้างถึงกรองด้วย** และนโยบาย "Students view grade items" ก็ซ่อนรายการของ
--    หมวดที่ติดธง is_final_exam ไว้อยู่แล้ว
--
--    ผลคือ subquery มองไม่เห็นแถวนั้น -> EXISTS เป็นเท็จ -> NOT EXISTS เป็นจริง
--    -> นโยบายอนุญาตให้อ่านคะแนนได้
--
--    พูดง่าย ๆ คือนโยบายที่เข้มกว่า (grade_items) ทำให้นโยบายที่ต้องพึ่งข้อมูล
--    เดียวกัน (student_grades) ตรวจไม่ได้ ยิ่งซ่อนดี ยิ่งรั่ว
--
--  วิธีแก้
--    ย้ายการตรวจไปอยู่ในฟังก์ชัน SECURITY DEFINER ซึ่งอ่านความจริงได้โดยไม่ติด
--    RLS แล้วให้นโยบายเรียกฟังก์ชันนั้น — รูปแบบเดียวกับ is_course_instructor()
--    ที่โปรเจกต์นี้ใช้อยู่แล้ว
--
--  ตรวจพบด้วยการทดสอบ RLS ในฐานะ role authenticated จริง การทดสอบด้วยผู้ใช้
--  superuser จะไม่เจอ เพราะ superuser ข้าม RLS ทั้งหมด
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ฟังก์ชันเดียวที่บอกความจริงว่าคะแนนของรายการนี้ถูกปิดบังอยู่หรือไม่ ──────
CREATE OR REPLACE FUNCTION public.grade_item_is_masked(_grade_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.grade_items gi
    JOIN public.courses c ON c.id = gi.course_id
    LEFT JOIN public.grade_components gc ON gc.id = gi.component_id
    WHERE gi.id = _grade_item_id
      AND NOT c.final_grade_published
      AND (gi.category = 'final' OR COALESCE(gc.is_final_exam, false))
  );
$$;

REVOKE ALL ON FUNCTION public.grade_item_is_masked(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grade_item_is_masked(uuid) TO authenticated;

COMMENT ON FUNCTION public.grade_item_is_masked(uuid) IS
  'true = คะแนนของรายการนี้ยังถูกปิดบังจากนักศึกษา (เป็นคะแนนปลายภาคและยังไม่ประกาศผล) '
  'ต้องเป็น SECURITY DEFINER เพราะถูกเรียกจากนิพจน์ USING ของนโยบาย RLS '
  'ถ้าเป็น SECURITY INVOKER นโยบายของ grade_items จะซ่อนแถวที่ต้องตรวจ '
  'ทำให้ตรวจไม่พบและปล่อยคะแนนปลายภาคหลุดออกไป';

-- ── นโยบายใหม่ที่ไม่ตาบอด ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Students view own grades" ON public.student_grades;
CREATE POLICY "Students view own grades" ON public.student_grades
  FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    AND NOT public.grade_item_is_masked(grade_item_id)
  );

-- ── นโยบายของ grade_items ก็ใช้ฟังก์ชัน SECURITY DEFINER ด้วยเหตุผลเดียวกัน ──
-- ของเดิมอ้าง grade_components ตรง ๆ ซึ่งวันนี้นักศึกษายังอ่านได้ จึงยังทำงาน
-- แต่ถ้าวันหนึ่งมีการรัดนโยบายของ grade_components ให้แคบลง นโยบายนี้จะตาบอด
-- แบบเดียวกันทันที จึงปิดความเสี่ยงไว้ตั้งแต่ตอนนี้
CREATE OR REPLACE FUNCTION public.grade_item_hidden_from_students(_grade_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.grade_items gi
    JOIN public.grade_components gc ON gc.id = gi.component_id
    JOIN public.courses c ON c.id = gc.course_id
    WHERE gi.id = _grade_item_id
      AND gc.is_final_exam
      AND NOT c.final_grade_published
  );
$$;

REVOKE ALL ON FUNCTION public.grade_item_hidden_from_students(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grade_item_hidden_from_students(uuid) TO authenticated;

DROP POLICY IF EXISTS "Enrolled students view grade items" ON public.grade_items;
DROP POLICY IF EXISTS "Students view grade items" ON public.grade_items;
CREATE POLICY "Students view grade items" ON public.grade_items
  FOR SELECT TO authenticated
  USING (
    public.is_enrolled_student(course_id, auth.uid())
    AND NOT public.grade_item_hidden_from_students(id)
  );
