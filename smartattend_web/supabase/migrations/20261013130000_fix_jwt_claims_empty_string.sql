-- ═══════════════════════════════════════════════════════════════════════════
--  แก้การอ่าน role จาก request.jwt.claims ที่โยน error ได้
--
--  อาการ
--    record_attendance และ device_heartbeat อ่าน role ด้วย
--      COALESCE((current_setting('request.jwt.claims', true))::jsonb ->> 'role', '')
--    current_setting(..., true) คืน "สตริงว่าง" เมื่อไม่มีค่า ไม่ใช่ NULL
--    แล้ว ''::jsonb โยน error ทันทีว่า
--      invalid input syntax for type json / The input string ended unexpectedly
--    COALESCE ไม่ช่วย เพราะการแปลงพังก่อนที่ COALESCE จะได้ทำงาน
--
--  เกิดขึ้นเมื่อไร
--    เมื่อผู้เรียกไม่มี request.jwt.claims ตั้งไว้ ซึ่งเกิดกับคีย์แบบใหม่
--    (sb_secret_... / sb_publishable_...) ที่ไม่ใช่ JWT
--    ผลคืออุปกรณ์ Raspberry Pi ที่ถือคีย์แบบใหม่จะเช็คชื่อไม่ได้เลย
--    และส่ง heartbeat ไม่ได้ด้วย ทั้งที่สิทธิ์ถูกต้องทุกอย่าง
--
--  เป็นบั๊กชนิดเดียวกับที่พบใน get_scan_roster เมื่อวาน (ดู migration
--  20261013100000_secure_get_scan_roster.sql บรรทัดที่ 28-32) ซึ่งตอนนั้น
--  แก้เฉพาะฟังก์ชันตัวนั้น รอบนี้ไล่เก็บสองตัวที่เหลือ
--
--  ตรวจทั้งโฟลเดอร์ migrations แล้ว เหลือสองจุดนี้เท่านั้น
--    20260927130000_record_attendance_server_time.sql:32  (record_attendance)
--    20260927130000_record_attendance_server_time.sql:174 (device_heartbeat)
--  หลัง migration นี้จะไม่มีจุดใดในฐานข้อมูลที่แปลง request.jwt.claims
--  เป็น jsonb โดยไม่ผ่าน NULLIF อีก
--
--  สิ่งที่เปลี่ยน — เฉพาะวิธีอ่าน role บรรทัดเดียวในแต่ละฟังก์ชัน
--  ตรรกะอื่นทั้งหมดคัดลอกมาจากไฟล์เดิมทั้งก้อนโดยไม่แก้แม้แต่ตัวอักษรเดียว
--  (สร้างไฟล์นี้ด้วยการตัดบรรทัด 19-146 และ 163-196 จากไฟล์เดิมมาแทนที่
--   เฉพาะสตริงที่อ่าน role แล้วตรวจความต่างด้วย diff)
--
--  ปลอดภัยเพราะ ถ้า request.jwt.claims มีค่าอยู่แล้ว NULLIF จะคืนค่าเดิม
--  พฤติกรรมจึงเหมือนเดิมทุกประการ ต่างกันเฉพาะกรณีที่เดิมพังเท่านั้น
--
--  คง REVOKE ALL FROM PUBLIC, anon และ GRANT TO authenticated, service_role
--  ไว้เหมือนเดิมทั้งสองฟังก์ชัน
-- ═══════════════════════════════════════════════════════════════════════════

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
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
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
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
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
