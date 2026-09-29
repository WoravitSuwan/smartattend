-- ═══════════════════════════════════════════════════════════════════════════
--  record_attendance() — บันทึกการเช็คชื่อจากอุปกรณ์หน้าห้องเรียน
--  ฟังก์ชันที่ทดสอบโหลดมาจาก migration 20260927130000_record_attendance_server_time.sql
--
--  ประเด็นสำคัญที่สุดที่เทสต์ชุดนี้คุ้ม
--    อุปกรณ์ Raspberry Pi ไม่มีนาฬิกาสำรอง เวลาของเครื่องเชื่อถือไม่ได้
--    การตัดสินตรงเวลา/มาสาย จึงต้องใช้ now() ของฐานข้อมูลเท่านั้น
--    และฟังก์ชันต้องไม่รับเวลาจากผู้เรียกเลย แม้จะส่งมาก็ตาม
-- ═══════════════════════════════════════════════════════════════════════════

\set SUITE 'record_attendance'

TRUNCATE public.courses CASCADE;

INSERT INTO auth.users(id) VALUES
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333')
ON CONFLICT DO NOTHING;

INSERT INTO public.courses(id, code, name, instructor_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'CS101', 'วิชาทดสอบ',
   '11111111-1111-1111-1111-111111111111');

INSERT INTO public.course_enrollments(course_id, student_id, status) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'confirmed'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'confirmed');

-- คาบที่เพิ่งเปิด (ยังไม่เกินเวลาสาย)
INSERT INTO public.class_sessions(id, course_id, started_at, late_after_minutes, status) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   now() - interval '2 minutes', 15, 'open');

-- คาบที่เปิดมานานแล้ว (เกินเวลาสายไปแล้ว)
INSERT INTO public.class_sessions(id, course_id, started_at, late_after_minutes, status) VALUES
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   now() - interval '40 minutes', 15, 'open');

-- คาบที่ปิดแล้ว และคาบที่ถูกสั่งหยุดสแกน
INSERT INTO public.class_sessions(id, course_id, started_at, status) VALUES
  ('cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   now() - interval '1 hour', 'closed');
INSERT INTO public.class_sessions(id, course_id, started_at, status, scanning_paused) VALUES
  ('cccccccc-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001',
   now(), 'open', true);

-- อุปกรณ์ Pi ถือ service key
SELECT t.act_as(NULL, 'service_role');

-- ── 1. เวลาต้องมาจาก now() ของฐานข้อมูลเท่านั้น ──────────────────────────────
SELECT t.eq(:'SUITE', 'คาบเพิ่งเปิด 2 นาที ได้สถานะ on_time',
  (SELECT public.record_attendance('cccccccc-0000-0000-0000-000000000001',
     '22222222-2222-2222-2222-222222222222', 0.9) ->> 'status'), 'on_time');

SELECT t.eq(:'SUITE', 'คาบเปิดมา 40 นาที เกินเกณฑ์ 15 นาที ได้สถานะ late',
  (SELECT public.record_attendance('cccccccc-0000-0000-0000-000000000002',
     '22222222-2222-2222-2222-222222222222', 0.9) ->> 'status'), 'late');

SELECT t.ok(:'SUITE', 'checked_in_at ที่บันทึกคือเวลาของฐานข้อมูล ไม่ใช่ของอุปกรณ์',
  (SELECT abs(extract(epoch FROM (ar.checked_in_at - now()))) < 5
     FROM public.attendance_records ar
    WHERE ar.session_id = 'cccccccc-0000-0000-0000-000000000001'),
  'ต้องห่างจาก now() ไม่เกิน 5 วินาที');

SELECT t.ok(:'SUITE', 'ฟังก์ชันไม่มีพารามิเตอร์ให้ส่งเวลาเข้ามาเลย',
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'record_attendance'
      AND EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.proallargtypes, p.proargtypes::oid[])) AS ty
        WHERE format_type(ty, NULL) LIKE 'timestamp%')),
  'ถ้ามีวันหนึ่งใครเพิ่มพารามิเตอร์เวลาเข้ามา เทสต์ข้อนี้จะพังทันที');

SELECT t.ok(:'SUITE', 'ค่าที่คืนกลับมีเวลาเซิร์ฟเวอร์ให้อุปกรณ์ตรวจนาฬิกาตัวเองได้',
  (SELECT (public.record_attendance('cccccccc-0000-0000-0000-000000000001',
     '33333333-3333-3333-3333-333333333333', 0.8) ->> 'server_time') IS NOT NULL));

-- ── 2. บันทึกซ้ำในคาบเดียวกัน ────────────────────────────────────────────────
SELECT t.eq(:'SUITE', 'สแกนซ้ำคืน already = true ไม่ใช่ error',
  (SELECT (public.record_attendance('cccccccc-0000-0000-0000-000000000001',
     '22222222-2222-2222-2222-222222222222', 0.95) ->> 'already')), 'true');

SELECT t.eq(:'SUITE', 'สแกนซ้ำคืนสถานะเดิม ไม่คำนวณใหม่',
  (SELECT public.record_attendance('cccccccc-0000-0000-0000-000000000001',
     '22222222-2222-2222-2222-222222222222', 0.95) ->> 'status'), 'on_time');

SELECT t.eq(:'SUITE', 'สแกนซ้ำสิบครั้งยังมีแถวเดียว',
  (SELECT count(*)::int FROM public.attendance_records
    WHERE session_id = 'cccccccc-0000-0000-0000-000000000001'
      AND student_id = '22222222-2222-2222-2222-222222222222'), 1);

SELECT t.ok(:'SUITE', 'สแกนซ้ำไม่เลื่อนเวลาเช็คชื่อเดิม',
  (SELECT count(DISTINCT checked_in_at)::int FROM public.attendance_records
    WHERE session_id = 'cccccccc-0000-0000-0000-000000000001'
      AND student_id = '22222222-2222-2222-2222-222222222222') = 1);

-- ── 3. เงื่อนไขของคาบเรียน ───────────────────────────────────────────────────
SELECT t.raises(:'SUITE', 'คาบที่ปิดแล้วเช็คชื่อไม่ได้',
  $q$ SELECT public.record_attendance('cccccccc-0000-0000-0000-000000000003',
        '22222222-2222-2222-2222-222222222222') $q$, 'session_not_open');

SELECT t.raises(:'SUITE', 'คาบที่ถูกสั่งหยุดสแกนเช็คชื่อไม่ได้',
  $q$ SELECT public.record_attendance('cccccccc-0000-0000-0000-000000000004',
        '22222222-2222-2222-2222-222222222222') $q$, 'scanning_paused');

SELECT t.raises(:'SUITE', 'คาบที่ไม่มีอยู่',
  $q$ SELECT public.record_attendance('cccccccc-0000-0000-0000-00000000dead',
        '22222222-2222-2222-2222-222222222222') $q$, 'session_not_found');

-- ── 4. เงื่อนไขของนักศึกษา ───────────────────────────────────────────────────
SELECT t.raises(:'SUITE', 'คนที่ไม่ได้อยู่ในรายวิชาเช็คชื่อไม่ได้',
  $q$ SELECT public.record_attendance('cccccccc-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111') $q$, 'not_enrolled');

UPDATE public.course_enrollments SET status = 'pending'
 WHERE student_id = '33333333-3333-3333-3333-333333333333';
SELECT t.raises(:'SUITE', 'คนที่ยังไม่กดยืนยันเข้าร่วมวิชาเช็คชื่อไม่ได้',
  $q$ SELECT public.record_attendance('cccccccc-0000-0000-0000-000000000002',
        '33333333-3333-3333-3333-333333333333') $q$, 'not_enrolled');
UPDATE public.course_enrollments SET status = 'confirmed'
 WHERE student_id = '33333333-3333-3333-3333-333333333333';

UPDATE public.course_enrollments SET attendance_blocked = true
 WHERE student_id = '33333333-3333-3333-3333-333333333333';
SELECT t.raises(:'SUITE', 'คนที่ถูกระงับสิทธิ์จากการขาดเรียนเช็คชื่อไม่ได้',
  $q$ SELECT public.record_attendance('cccccccc-0000-0000-0000-000000000002',
        '33333333-3333-3333-3333-333333333333') $q$, 'attendance_blocked');
UPDATE public.course_enrollments SET attendance_blocked = false
 WHERE student_id = '33333333-3333-3333-3333-333333333333';

-- ── 5. สิทธิ์ในการบันทึก ─────────────────────────────────────────────────────
SELECT t.act_as(NULL, 'anon');
SELECT t.raises(:'SUITE', 'ผู้ใช้ที่ยังไม่ล็อกอินบันทึกไม่ได้',
  $q$ SELECT public.record_attendance('cccccccc-0000-0000-0000-000000000002',
        '22222222-2222-2222-2222-222222222222') $q$, 'unauthorized');

SELECT t.act_as('22222222-2222-2222-2222-222222222222');
SELECT t.raises(:'SUITE', 'นักศึกษาบันทึกแทนคนอื่นไม่ได้',
  $q$ SELECT public.record_attendance('cccccccc-0000-0000-0000-000000000002',
        '33333333-3333-3333-3333-333333333333') $q$, 'forbidden');

SELECT t.act_as('11111111-1111-1111-1111-111111111111');
SELECT t.eq(:'SUITE', 'ผู้สอนของวิชาบันทึกแทนนักศึกษาได้ (แก้เคสกล้องพัง)',
  (SELECT public.record_attendance('cccccccc-0000-0000-0000-000000000002',
     '33333333-3333-3333-3333-333333333333') ->> 'status'), 'late');

-- ── 6. ค่าความเชื่อมั่นต้องอยู่ในช่วง 0..1 ────────────────────────────────────
SELECT t.act_as(NULL, 'service_role');
INSERT INTO public.class_sessions(id, course_id, started_at, status) VALUES
  ('cccccccc-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001',
   now(), 'open');

SELECT t.runs(:'SUITE', 'ส่ง confidence เกิน 1 มาได้โดยไม่ error',
  $q$ SELECT public.record_attendance('cccccccc-0000-0000-0000-000000000005',
        '22222222-2222-2222-2222-222222222222', 9.9) $q$);

SELECT t.eq(:'SUITE', 'confidence ถูกบีบให้อยู่ในช่วง 0..1',
  (SELECT confidence FROM public.attendance_records
    WHERE session_id = 'cccccccc-0000-0000-0000-000000000005'), 1::numeric);
