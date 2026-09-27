-- ย้ายการตัดสิน "ตรงเวลา / มาสาย" จากนาฬิกาของอุปกรณ์มาไว้ที่เซิร์ฟเวอร์
--
-- ปัญหาของเดิม (smartattend_pi/supabase_client.py :152-177)
--   Pi ใช้ datetime.now() ของตัวเองคำนวณสถานะ แล้ว insert ลง attendance_records
--   ตรง ๆ พร้อม checked_in_at ที่เป็นเวลาของ Pi เอง
--   Raspberry Pi ไม่มีนาฬิกาสำรอง (RTC) — ถ้าบูตตอนไม่มีเน็ต เวลาจะเพี้ยน
--   ได้เป็นวัน (เครื่องจริงในโครงงานนี้เคยเดินช้าไป 15 วัน) ทุกการเช็คชื่อ
--   จะถูกบันทึกด้วยเวลาย้อนหลังและสถานะที่คำนวณผิด
--   และ docstring ของฟังก์ชันเดิมเขียนว่า "ใช้เวลาของเซิร์ฟเวอร์" ซึ่งไม่จริง
--
-- ของใหม่: RPC เดียวที่คำนวณทุกอย่างในฐานข้อมูลด้วย now()
--   อุปกรณ์ส่งมาแค่ ใครคือใคร / ความมั่นใจ / ภาพหลักฐาน
--   สถานะที่แสดงบนจอ Pi คือค่าที่เซิร์ฟเวอร์ตอบกลับ ไม่ใช่ค่าที่ Pi คิดเอง
--
-- การกันบันทึกซ้ำใช้ UNIQUE (session_id, student_id) ที่มีอยู่แล้วเป็นหลัก
-- ถ้ามีแถวอยู่แล้วจะไม่ error แต่คืน already = true พร้อมสถานะเดิม เพื่อให้
-- คิวส่งซ้ำของอุปกรณ์ (กรณีเน็ตหลุดแล้วส่งใหม่) ปลอดภัยโดยไม่เกิดแถวซ้ำ

CREATE OR REPLACE FUNCTION public.record_attendance(
  _session_id uuid,
  _student_id uuid,
  _confidence numeric DEFAULT NULL,
  _photo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _jwt_role text := COALESCE(
    (current_setting('request.jwt.claims', true))::jsonb ->> 'role', '');
  _uid uuid := auth.uid();
  _course_id uuid;
  _started_at timestamptz;
  _late_after integer;
  _paused boolean;
  _sess_status text;
  _blocked boolean;
  _enrolled boolean;
  _existing_status text;
  _existing_at timestamptz;
  _status text;
  _inserted integer;
  _now timestamptz := now();   -- เวลาของเซิร์ฟเวอร์ ตรึงค่าไว้ครั้งเดียว
BEGIN
  SELECT cs.course_id, cs.started_at, cs.late_after_minutes, cs.scanning_paused, cs.status
    INTO _course_id, _started_at, _late_after, _paused, _sess_status
  FROM public.class_sessions cs
  WHERE cs.id = _session_id;

  IF _course_id IS NULL THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  -- ── สิทธิ์ในการบันทึก ────────────────────────────────────────────────────
  -- service_role = อุปกรณ์ Pi (ถือ service key อยู่ในเครื่องที่ติดตั้งเอง)
  -- ผู้ใช้ที่ล็อกอิน = บันทึกของตัวเองได้ หรือเป็นผู้สอนของวิชานั้น/แอดมิน
  -- anon ถูกตัดทั้งด้วย REVOKE ข้างล่างและด้วยเงื่อนไขนี้
  IF _jwt_role <> 'service_role' THEN
    IF _uid IS NULL THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
    IF _uid <> _student_id
       AND NOT public.is_course_instructor(_course_id, _uid)
       AND NOT internal.has_role(_uid, 'admin'::app_role) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  -- ── เงื่อนไขของคาบเรียน ─────────────────────────────────────────────────
  IF _sess_status <> 'open' THEN
    RAISE EXCEPTION 'session_not_open';
  END IF;
  IF _paused THEN
    RAISE EXCEPTION 'scanning_paused';
  END IF;

  -- ── เงื่อนไขของนักศึกษา ─────────────────────────────────────────────────
  SELECT true, ce.attendance_blocked
    INTO _enrolled, _blocked
  FROM public.course_enrollments ce
  WHERE ce.course_id = _course_id
    AND ce.student_id = _student_id
    AND ce.status = 'confirmed'
  LIMIT 1;

  IF NOT COALESCE(_enrolled, false) THEN
    RAISE EXCEPTION 'not_enrolled';
  END IF;
  IF COALESCE(_blocked, false) THEN
    RAISE EXCEPTION 'attendance_blocked';
  END IF;

  -- ── บันทึกซ้ำ: ไม่ถือเป็นข้อผิดพลาด คืนสถานะเดิมกลับไป ──────────────────
  SELECT ar.status, ar.checked_in_at INTO _existing_status, _existing_at
  FROM public.attendance_records ar
  WHERE ar.session_id = _session_id AND ar.student_id = _student_id;

  IF _existing_status IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', _existing_status,
      'checked_in_at', _existing_at,
      'already', true,
      'server_time', _now);
  END IF;

  -- ── คำนวณสถานะด้วยเวลาของเซิร์ฟเวอร์เท่านั้น ───────────────────────────
  _late_after := COALESCE(_late_after, 15);
  IF _now > _started_at + make_interval(mins => _late_after) THEN
    _status := 'late';
  ELSE
    _status := 'on_time';
  END IF;

  INSERT INTO public.attendance_records
    (session_id, student_id, status, checked_in_at, photo_data_url, confidence)
  VALUES
    (_session_id, _student_id, _status, _now, _photo,
     LEAST(GREATEST(COALESCE(_confidence, 0), 0), 1))
  ON CONFLICT (session_id, student_id) DO NOTHING;
  GET DIAGNOSTICS _inserted = ROW_COUNT;

  -- แข่งกันบันทึกพร้อมกัน (สองเฟรมติดกัน หรือคิวส่งซ้ำชนกับของจริง)
  -- ถ้า insert ไม่เข้า แถวที่อยู่ก่อนคือแถวที่ถูก อ่านค่าจริงกลับไปแสดง
  IF _inserted = 0 THEN
    SELECT ar.status, ar.checked_in_at INTO _existing_status, _existing_at
    FROM public.attendance_records ar
    WHERE ar.session_id = _session_id AND ar.student_id = _student_id;
    RETURN jsonb_build_object(
      'status', _existing_status,
      'checked_in_at', _existing_at,
      'already', true,
      'server_time', _now);
  END IF;

  RETURN jsonb_build_object(
    'status', _status,
    'checked_in_at', _now,
    'already', false,
    'server_time', _now);
END;
$$;

REVOKE ALL ON FUNCTION public.record_attendance(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_attendance(uuid, uuid, numeric, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.record_attendance(uuid, uuid, numeric, text) IS
  'บันทึกการเข้าเรียนโดยคำนวณสถานะ on_time/late จาก now() ของเซิร์ฟเวอร์ '
  'เทียบกับ class_sessions.started_at + late_after_minutes '
  'ห้ามให้อุปกรณ์หรือเบราว์เซอร์ส่งสถานะหรือเวลามาเอง';

-- ───────────────────────────────────────────────────────────────────────────
-- heartbeat ก็ต้องใช้เวลาของเซิร์ฟเวอร์ด้วยเหตุผลเดียวกัน
--
-- ของเดิม Pi ส่ง seen_at = datetime.now() ของตัวเองมา หน้าเว็บใช้ค่านี้ตัดสินว่า
-- อุปกรณ์ออนไลน์อยู่หรือไม่ นาฬิกาที่เพี้ยนจึงทำให้แผงสถานะบอกว่า Pi ออฟไลน์
-- ตลอดเวลา (หรือเห็นเวลาในอนาคต) ทั้งที่เครื่องทำงานปกติ
--
-- จะให้ Pi ละคอลัมน์ seen_at ไปเลยก็ไม่ได้ เพราะ PostgREST upsert แบบ
-- merge-duplicates จะ UPDATE เฉพาะคอลัมน์ที่ส่งมา ค่าเดิมจึงค้างอยู่
-- ต้องมี RPC ที่เขียน now() ให้
CREATE OR REPLACE FUNCTION public.device_heartbeat(
  _device_code text,
  _room text DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _jwt_role text := COALESCE(
    (current_setting('request.jwt.claims', true))::jsonb ->> 'role', '');
  _now timestamptz := now();
BEGIN
  -- เขียนได้จากอุปกรณ์ (service key) หรือแอดมินเท่านั้น
  IF _jwt_role <> 'service_role'
     AND NOT internal.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _device_code IS NULL OR btrim(_device_code) = '' THEN
    RAISE EXCEPTION 'device_code_required';
  END IF;

  INSERT INTO public.device_heartbeats (device_code, room, seen_at)
  VALUES (btrim(_device_code), NULLIF(btrim(COALESCE(_room, '')), ''), _now)
  ON CONFLICT (device_code) DO UPDATE
    SET room = EXCLUDED.room, seen_at = _now;

  RETURN _now;
END;
$$;

REVOKE ALL ON FUNCTION public.device_heartbeat(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.device_heartbeat(text, text) TO authenticated, service_role;
