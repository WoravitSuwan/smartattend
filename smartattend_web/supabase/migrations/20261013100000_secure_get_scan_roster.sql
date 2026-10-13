-- ═══════════════════════════════════════════════════════════════════════════
--  DEF-001 — get_scan_roster เปิดให้ใครก็ดึงรายชื่อนักศึกษาทั้งรายวิชาได้
--
--  อาการที่พบจากการทดสอบ (กรณี G-02h, G-03e, G-06d)
--    ผู้ใช้ที่ยังไม่ล็อกอิน (role anon) ยิงผ่าน REST ก็ได้รายชื่อนักศึกษาครบ
--    พร้อมรหัสนักศึกษาและชื่อ-นามสกุล ซึ่งเป็นข้อมูลส่วนบุคคล
--
--  สาเหตุมีสองชั้นซ้อนกัน
--    1. ฟังก์ชันเป็น SECURITY DEFINER จึงข้าม RLS แต่ไม่มีการตรวจสิทธิ์
--       ของผู้เรียกในตัวฟังก์ชัน ต่างจาก RPC ตัวอื่นในระบบนี้ที่ตรวจทุกตัว
--    2. PostgreSQL ให้สิทธิ์ EXECUTE แก่ PUBLIC กับฟังก์ชันใหม่ทุกตัวโดยปริยาย
--       migration เดิม (20260926090000) เขียน GRANT เพิ่มแต่ไม่ได้ REVOKE
--       จาก PUBLIC ค่าสิทธิ์จริงในแคตตาล็อกจึงเป็น =X/postgres
--
--  เรื่องที่ต้องระวัง — อุปกรณ์ Raspberry Pi เรียกฟังก์ชันนี้
--    smartattend_pi/supabase_client.py:96 เรียก get_scan_roster
--    โดยใช้ SUPABASE_SERVICE_KEY (บรรทัดที่ 19, 30-31) ซึ่งเป็น service role
--    จึงผ่านเงื่อนไขแรกได้ ไม่ต้องแก้ฝั่งอุปกรณ์
--
--    การตรวจ service role ทำสองทางเพื่อไม่ให้อุปกรณ์หยุดทำงาน
--      ก. current_setting('role') = 'service_role' — PostgREST สั่ง SET ROLE
--         ให้ตามคีย์ที่ใช้ ครอบคลุมคีย์แบบใหม่ (sb_secret_...) ที่ไม่ใช่ JWT
--      ข. request.jwt.claims ->> 'role' = 'service_role' — ใช้กับคีย์แบบ JWT
--    ทั้งสองทางเกิดได้เฉพาะเมื่อผู้เรียกถือ service key จริง จึงไม่ได้หย่อนลง
--
--    ห้ามใช้ current_user ตรวจ เพราะในฟังก์ชัน SECURITY DEFINER ค่านี้คือ
--    "เจ้าของฟังก์ชัน" (postgres) ไม่ใช่ผู้เรียก ทดสอบแล้วได้ current_user=postgres
--    ขณะที่ current_setting('role') ได้ service_role ตามจริง
--
--    ต้องใส่ NULLIF ก่อนแปลงเป็น jsonb ด้วย เพราะถ้า request.jwt.claims เป็น
--    สตริงว่าง การแปลง ''::jsonb จะโยน error "invalid input syntax for type json"
--    แล้วฟังก์ชันจะพังแทนที่จะปฏิเสธอย่างสุภาพ (ทดสอบเจอจริง)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_scan_roster(_course_id uuid)
RETURNS TABLE (student_id uuid, student_code text, student_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(current_setting('role', true), '') <> 'service_role'
     AND COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb
                   ->> 'role', '') <> 'service_role'
     AND NOT public.is_course_instructor(_course_id, auth.uid())
     AND NOT internal.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูรายชื่อของรายวิชานี้'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT ce.student_id, p.student_code, p.name
  FROM public.course_enrollments ce
  LEFT JOIN public.profiles p ON p.user_id = ce.student_id
  WHERE ce.course_id = _course_id
    AND ce.status = 'confirmed'
    AND ce.student_id IS NOT NULL
    AND NOT ce.attendance_blocked;
END $$;

-- ตัดสิทธิ์ที่ PostgreSQL ให้ PUBLIC มาโดยปริยาย แล้วให้เฉพาะที่ต้องใช้จริง
REVOKE ALL ON FUNCTION public.get_scan_roster(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_scan_roster(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_scan_roster(uuid) IS
  'รายชื่อนักศึกษาที่ยืนยันแล้วและยังไม่ถูกระงับสิทธิ์ สำหรับอุปกรณ์สแกนใบหน้า '
  'เรียกได้เฉพาะอาจารย์ผู้สอนของรายวิชานั้น ผู้ดูแลระบบ และอุปกรณ์ที่ถือ service key';
