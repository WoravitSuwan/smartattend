-- ═══════════════════════════════════════════════════════════════════════════
--  แก้ log_audit_event() ที่เรียกฟังก์ชันซึ่งถูกลบไปแล้ว
--
--  อาการที่พบจากการใช้งานจริง
--    กดปุ่ม "บันทึกโครงสร้างคะแนน" แล้วขึ้น
--      function public.has_role(uuid, app_role) does not exist
--    กดบันทึกเกณฑ์ตัดเกรด บันทึกรายการคะแนน ลบหัวข้อคะแนน ประกาศผล
--    ปลดล็อกคะแนน ก็พังด้วยข้อความเดียวกันทั้งหมด
--
--  สาเหตุ
--    ไล่ประวัติ migration ได้ดังนี้
--      20260703090933  สร้าง public.has_role()
--      20260705031229  ALTER FUNCTION ... SET SCHEMA internal   (ย้ายไป internal)
--      20260710034506  สร้าง public.has_role() ขึ้นมาใหม่อีกตัว
--      20260711075028  DROP FUNCTION public.has_role()          (ลบตัวใน public)
--      20260724040344  สร้าง log_audit_event() ที่เรียก public.has_role()  ← ผิด
--
--    migration ตัวสุดท้ายเขียน public.has_role ทั้งที่ตัวนั้นถูกลบไปสิบสามวันก่อน
--    และ PostgreSQL ไม่จับตอน CREATE FUNCTION เพราะเนื้อฟังก์ชัน plpgsql เป็น
--    ข้อความธรรมดา ไม่ถูกตรวจ dependency จนกว่าจะถูกเรียกใช้จริง
--    (ถ้าเป็นนโยบาย RLS หรือ view จะถูกจับทันทีตอน DROP)
--
--    log_audit_event() ถูกเรียกจาก RPC ที่เขียนข้อมูลแทบทุกตัว การบันทึกทุกอย่าง
--    ที่ต้องมีร่องรอยจึงล้มทั้งหมด และเป็นการล้มทั้งทรานแซกชัน ข้อมูลไม่ถูกเขียนเลย
--
--  การแก้
--    เปลี่ยนไปเรียก internal.has_role() ซึ่งเป็นตัวที่มีอยู่จริง
--    ไม่สร้าง public.has_role กลับมา เพราะการย้ายไป internal เมื่อ 20260705
--    เป็นการตั้งใจปิดไม่ให้ยิงผ่าน REST ได้ (ฟังก์ชันใน public ที่ authenticated
--    มีสิทธิ์ execute จะเรียกผ่าน /rest/v1/rpc/ ได้) การสร้างกลับมาคือเปิด
--    ช่องเดิมอีกครั้ง
--
--  ส่วนที่เหลือของฟังก์ชันคงเดิมทุกบรรทัด
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.log_audit_event(
  _action text,
  _target text DEFAULT NULL,
  _target_id text DEFAULT NULL,
  _detail text DEFAULT NULL,
  _before jsonb DEFAULT NULL,
  _after jsonb DEFAULT NULL,
  _reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _name text;
  _role text;
  _id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF _action IS NULL OR length(_action) = 0 OR length(_action) > 100 THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;

  SELECT name INTO _name FROM public.profiles WHERE user_id = _uid;

  -- internal.has_role ไม่ใช่ public.has_role — ตัวใน public ถูกลบไปแล้วตั้งแต่
  -- migration 20260711075028 ห้ามเปลี่ยนกลับเป็น public
  SELECT CASE
    WHEN internal.has_role(_uid, 'admin'::app_role) THEN 'admin'
    WHEN internal.has_role(_uid, 'instructor'::app_role) THEN 'instructor'
    ELSE 'student'
  END INTO _role;

  INSERT INTO public.audit_logs (
    actor_id, actor_name, actor_role, action, target, target_id, detail, before, after, reason
  ) VALUES (
    _uid, _name, _role, _action, _target, _target_id,
    left(coalesce(_detail, ''), 2000),
    _before, _after,
    left(coalesce(_reason, ''), 1000)
  )
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit_event(text, text, text, text, jsonb, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, text, text, text, jsonb, jsonb, text)
  TO authenticated;

COMMENT ON FUNCTION public.log_audit_event(text, text, text, text, jsonb, jsonb, text) IS
  'บันทึกเหตุการณ์ลง audit_logs ถูกเรียกจาก RPC ที่เขียนข้อมูลแทบทุกตัว '
  'ต้องเรียก internal.has_role() เท่านั้น public.has_role() ถูกลบไปแล้วตั้งแต่ '
  'migration 20260711075028 การเรียกผิด schema ทำให้ RPC ที่เขียนข้อมูลล้มทั้งหมด';

-- ───────────────────────────────────────────────────────────────────────────
--  กันไม่ให้เกิดซ้ำ: ตรวจว่าไม่มีฟังก์ชันไหนในฐานข้อมูลเรียก public.has_role อีก
--
--  เนื้อฟังก์ชัน plpgsql ไม่ถูกตรวจ dependency ตอนสร้าง บั๊กแบบนี้จึงหลุดไปถึง
--  หน้าจอผู้ใช้ได้ การสแกน prosrc ตอน migration เป็นตาข่ายที่ถูกที่สุดที่มี
-- ───────────────────────────────────────────────────────────────────────────
DO $check$
DECLARE
  v_bad text;
BEGIN
  -- ต้องตัดคอมเมนต์ออกก่อนค้น ไม่งั้นคอมเมนต์ที่อธิบายบั๊กนี้ (ซึ่งต้องพิมพ์ชื่อ
  -- ฟังก์ชันที่ห้ามใช้) จะถูกนับเป็นการเรียกใช้เอง — เจอตอนทดสอบจริงมาแล้ว
  -- และค้นด้วยวงเล็บเปิดด้วย เพื่อให้จับเฉพาะ "การเรียก" ไม่ใช่การเอ่ยถึงเฉย ๆ
  SELECT string_agg(n.nspname || '.' || p.proname, ', ')
    INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'internal')
    AND regexp_replace(
          regexp_replace(p.prosrc, '/\*.*?\*/', '', 'gs'),   -- คอมเมนต์แบบบล็อก
          '--[^\n]*', '', 'g')                                -- คอมเมนต์แบบบรรทัด
        LIKE '%public.has_role(%';

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'ยังมีฟังก์ชันที่เรียก public.has_role ซึ่งถูกลบไปแล้ว: % — ต้องเปลี่ยนเป็น internal.has_role ก่อน',
      v_bad;
  END IF;

  IF to_regprocedure('internal.has_role(uuid, public.app_role)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ internal.has_role() ฐานข้อมูลนี้ยังไม่ได้รับ migration 20260705031229';
  END IF;

  RAISE NOTICE 'ตรวจแล้ว: ไม่มีฟังก์ชันใดเรียก public.has_role และ internal.has_role มีอยู่จริง';
END
$check$;
