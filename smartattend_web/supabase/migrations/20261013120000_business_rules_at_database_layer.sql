-- ═══════════════════════════════════════════════════════════════════════════
--  DEF-002, DEF-003, DEF-004, DEF-006 — ย้ายกฎทางธุรกิจจาก RPC ลงชั้นฐานข้อมูล
--
--  ปัญหาร่วมของทั้งสี่ข้อ
--    กฎสำคัญถูกบังคับเฉพาะตอนเรียกผ่าน RPC แต่นโยบาย RLS ของ student_grades
--    และ attendance_records เปิดให้อาจารย์เขียนตารางตรงได้ทุกคำสั่ง (FOR ALL)
--    อาจารย์ทุกคนถือ JWT ที่ยิง PostgREST ได้โดยตรง เช่น
--      PATCH /rest/v1/student_grades?id=eq.<id>
--    จึงข้าม RPC และข้ามกฎทั้งหมดได้ กรณีทดสอบที่พิสูจน์คือ
--      F-05c กรอกคะแนน 9999 ในหัวข้อที่เต็ม 10 ได้
--      F-15d แก้คะแนนได้แม้ประกาศผลและล็อกแล้ว
--      D-11  แก้สถานะการเข้าเรียนได้โดยไม่ใส่เหตุผล
--      F-07a/F-07b แก้คะแนนที่บันทึกแล้วได้โดยไม่ใส่เหตุผล
--
--  วิธีแก้ ย้ายกฎไปเป็น trigger และ constraint ซึ่งบังคับกับทุกเส้นทางที่เขียน
--  ข้อมูล ไม่ว่าจะมาทาง RPC ทาง PostgREST หรือทาง SQL ตรง
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. DEF-002 + DEF-003 — เพดานคะแนนเต็ม และการล็อกหลังประกาศผล
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_student_grade_rules()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_max numeric; v_course uuid; v_name text;
BEGIN
  SELECT gi.max_score, gi.course_id, gi.name
    INTO v_max, v_course, v_name
  FROM public.grade_items gi WHERE gi.id = NEW.grade_item_id;

  IF NEW.score IS NOT NULL AND v_max IS NOT NULL AND NEW.score > v_max THEN
    RAISE EXCEPTION 'คะแนนเกินคะแนนเต็ม — หัวข้อ "%" เต็ม % แต่ได้รับ %',
      v_name, v_max, NEW.score USING ERRCODE = 'check_violation';
  END IF;

  -- ช่องยกเว้นสำหรับ RPC ที่เชื่อถือได้ ซึ่งต้องเขียนขณะรายวิชาถูกล็อก
  -- ตั้งด้วย SET LOCAL จึงมีผลแค่ใน transaction นั้น ไม่รั่วไปคำสั่งอื่น
  IF public.course_grades_locked(v_course)
     AND COALESCE(current_setting('app.bypass_grade_lock', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'รายวิชานี้ประกาศผลแล้วและคะแนนถูกล็อก ต้องปลดล็อกพร้อมระบุเหตุผลก่อนแก้'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_student_grade_rules ON public.student_grades;
CREATE TRIGGER trg_enforce_student_grade_rules
  BEFORE INSERT OR UPDATE ON public.student_grades
  FOR EACH ROW EXECUTE FUNCTION public.enforce_student_grade_rules();

-- ───────────────────────────────────────────────────────────────────────────
-- 2. DEF-004 — แก้สถานะการเข้าเรียนย้อนหลังต้องระบุเหตุผล
--
--    ใส่ NOT VALID ไว้ก่อน เพราะถ้าในฐานข้อมูลจริงมีแถวเก่าที่ edited_at
--    ไม่ว่างแต่ edit_reason ว่าง การเพิ่ม constraint แบบปกติจะล้มทั้ง migration
--    NOT VALID บังคับกับแถวใหม่และแถวที่ถูกแก้ตั้งแต่นี้ไปทันที
--    ส่วนแถวเก่าจะยังไม่ถูกตรวจจนกว่าจะสั่ง VALIDATE
--
--    ก่อน VALIDATE ให้นับแถวเก่าที่ยังไม่ผ่านเกณฑ์ก่อนเสมอ
--      SELECT count(*) FROM public.attendance_records
--      WHERE edited_at IS NOT NULL AND COALESCE(btrim(edit_reason),'') = '';
--    ถ้าได้ 0 จึงสั่ง
--      ALTER TABLE public.attendance_records
--        VALIDATE CONSTRAINT attendance_edit_needs_reason;
--    ถ้าได้มากกว่า 0 ต้องให้เจ้าของโปรเจกต์ตัดสินใจก่อนว่าจะเติมเหตุผล
--    ย้อนหลังหรือจะปล่อยไว้ migration นี้จึงไม่ VALIDATE ให้เอง
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_edit_needs_reason;
ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_edit_needs_reason
  CHECK (edited_at IS NULL OR COALESCE(btrim(edit_reason), '') <> '')
  NOT VALID;

-- CHECK เพียงอย่างเดียวให้ข้อความว่า "violates check constraint ..." ซึ่งเป็น
-- ภาษาอังกฤษและผู้ใช้อ่านไม่รู้เรื่อง จึงเพิ่ม trigger ให้ข้อความภาษาไทยก่อน
-- (trigger ทำงานก่อนการตรวจ constraint เสมอ)
CREATE OR REPLACE FUNCTION public.enforce_attendance_edit_reason()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.edited_at IS NOT NULL AND COALESCE(btrim(NEW.edit_reason), '') = '' THEN
    RAISE EXCEPTION 'การแก้สถานะการเข้าเรียนย้อนหลังต้องระบุเหตุผล'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_attendance_edit_reason ON public.attendance_records;
CREATE TRIGGER trg_enforce_attendance_edit_reason
  BEFORE INSERT OR UPDATE ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_attendance_edit_reason();

-- ───────────────────────────────────────────────────────────────────────────
-- 3. DEF-006 — แก้คะแนนที่บันทึกแล้วต้องระบุเหตุผล
--
--    บังคับที่ตารางประวัติ ซึ่ง RPC ทุกตัวที่แก้คะแนนเขียนลงเสมอ
--    จึงครอบคลุมทั้ง upsert_student_grade และ save_student_grades
--    โดยไม่ต้องแก้ตัวฟังก์ชัน และครอบคลุมเส้นทางใหม่ที่อาจเพิ่มในอนาคตด้วย
--
--    ขอบเขตที่บังคับ — เฉพาะ "การแก้ค่าที่มีอยู่แล้ว" (previous_score ไม่ว่าง)
--    ไม่บังคับกับการกรอกคะแนนครั้งแรก เพราะถ้าบังคับด้วย อาจารย์จะต้องพิมพ์
--    เหตุผลทุกช่องตอนกรอกคะแนนครั้งแรกทั้งห้อง ซึ่งใช้งานจริงไม่ได้
--
--    ใช้สองชั้น trigger ให้ข้อความภาษาไทยที่อ่านรู้เรื่อง (ทำงานก่อน constraint)
--    และ CHECK เป็นหลักประกันถาวรที่ลบไม่ได้ด้วยการแก้โค้ดฟังก์ชัน
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_grade_edit_reason()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.previous_score IS NOT NULL
     AND NEW.previous_score IS DISTINCT FROM NEW.new_score
     AND COALESCE(btrim(NEW.reason), '') = '' THEN
    RAISE EXCEPTION 'การแก้คะแนนที่บันทึกไว้แล้วต้องระบุเหตุผล (เดิม % เป็น %)',
      NEW.previous_score, COALESCE(NEW.new_score::text, 'ว่าง')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_grade_edit_reason ON public.grade_audit_logs;
CREATE TRIGGER trg_enforce_grade_edit_reason
  BEFORE INSERT ON public.grade_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_grade_edit_reason();

ALTER TABLE public.grade_audit_logs
  DROP CONSTRAINT IF EXISTS grade_edit_needs_reason;
ALTER TABLE public.grade_audit_logs
  ADD CONSTRAINT grade_edit_needs_reason
  CHECK (previous_score IS NULL
         OR previous_score IS NOT DISTINCT FROM new_score
         OR COALESCE(btrim(reason), '') <> '')
  NOT VALID;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. ช่องยกเว้นให้ RPC ที่เชื่อถือได้เขียนขณะรายวิชาถูกล็อก
--
--    อ่านโค้ดแล้วทั้งสองฟังก์ชันนี้เขียนแค่ course_final_grades, courses
--    และ notifications ไม่ได้เขียน student_grades โดยตรง จึงยังไม่ติด trigger
--    แต่ใส่ไว้เป็นหลักประกัน เผื่อมีการเพิ่มการเขียนคะแนนเข้าไปภายหลัง
--    ใช้ SET LOCAL จึงหมดผลเมื่อจบ transaction ไม่รั่วไปคำสั่งอื่น
-- ───────────────────────────────────────────────────────────────────────────
DO $migration$
DECLARE
  v_src text;
BEGIN
  FOREACH v_src IN ARRAY ARRAY['publish_final_grades', 'unlock_course_grades'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_src
    ) THEN
      RAISE EXCEPTION 'ไม่พบฟังก์ชัน public.% — migration นี้ตั้งอยู่บนสมมติฐานที่ผิด', v_src;
    END IF;
  END LOOP;
END $migration$;

COMMENT ON FUNCTION public.enforce_student_grade_rules() IS
  'บังคับเพดานคะแนนเต็มและการล็อกหลังประกาศผลที่ชั้นตาราง จึงมีผลกับทุกเส้นทาง '
  'ที่เขียนข้อมูล ไม่ใช่เฉพาะที่เรียกผ่าน RPC';
COMMENT ON FUNCTION public.enforce_attendance_edit_reason() IS
  'บังคับให้การแก้สถานะการเข้าเรียนย้อนหลังต้องระบุเหตุผล';
COMMENT ON FUNCTION public.enforce_grade_edit_reason() IS
  'บังคับให้การแก้คะแนนที่บันทึกไว้แล้วต้องระบุเหตุผล ไม่บังคับกับการกรอกครั้งแรก';
