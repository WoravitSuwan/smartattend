-- ═══════════════════════════════════════════════════════════════════════════
--  กลุ่ม D — คาบเรียนและการเช็คชื่อ (UC-07 ถึง UC-11)
--  เฉพาะข้อที่ทดสอบได้ที่ชั้นฐานข้อมูล
--  ข้อที่ต้องใช้กล้องและอุปกรณ์จริง (D-01, D-02, D-06, D-15) อยู่ใน
--  docs/รายการตรวจสอบด้วยมือ.md
-- ═══════════════════════════════════════════════════════════════════════════
\set INS    '11111111-1111-4111-8111-111111111102'
\set STU1   '11111111-1111-4111-8111-111111111201'
\set STU2   '11111111-1111-4111-8111-111111111202'
\set STU3   '11111111-1111-4111-8111-111111111203'
\set STU4   '11111111-1111-4111-8111-111111111204'
\set COURSE '22222222-2222-4222-8222-222222222201'
\set SOPEN  '33333333-3333-4333-8333-333333330099'

-- คาบที่เปิดอยู่สำหรับทดสอบการเช็คชื่อ (เริ่มมาแล้ว 5 นาที นับสายเมื่อเกิน 15 นาที)
RESET ROLE;
INSERT INTO public.class_sessions
  (id, course_id, instructor_id, started_at, status, late_after_minutes, counts_for_grade)
VALUES (:'SOPEN', :'COURSE', :'INS', now() - interval '5 min', 'open', 15, true);

SELECT q.act_as(:'INS');
SET ROLE authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- D-03 สแกนใบหน้าภายในเวลาที่ยังไม่สาย ต้องได้สถานะตรงเวลา
-- ───────────────────────────────────────────────────────────────────────────
SELECT q.eq('D','D-03','เช็คชื่อภายใน 15 นาทีแรก (ผ่านมา 5 นาที)','สถานะ on_time',
  public.record_attendance(:'SOPEN', :'STU1', 0.92, NULL)->>'status', 'on_time');

-- ───────────────────────────────────────────────────────────────────────────
-- D-04 สแกนใบหน้าหลังเวลานับสาย ต้องได้สถานะมาสาย
--   เลื่อนเวลาเริ่มคาบให้ย้อนไป 40 นาที แทนการรอจริง
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
UPDATE public.class_sessions SET started_at = now() - interval '40 min' WHERE id = :'SOPEN';
SELECT q.act_as(:'INS');
SET ROLE authenticated;

SELECT q.eq('D','D-04','เช็คชื่อหลังผ่านไป 40 นาที (เกณฑ์สาย 15 นาที)','สถานะ late',
  public.record_attendance(:'SOPEN', :'STU2', 0.88, NULL)->>'status', 'late');

-- ───────────────────────────────────────────────────────────────────────────
-- D-05 สแกนซ้ำในคาบเดียวกัน ต้องไม่บันทึกซ้ำ
-- ───────────────────────────────────────────────────────────────────────────
SELECT q.ok('D','D-05a','เช็คชื่อซ้ำคนเดิมในคาบเดิม ต้องไม่สร้างแถวใหม่',
  'ระบบตอบว่าเคยเช็คแล้ว (already = true)',
  (public.record_attendance(:'SOPEN', :'STU1', 0.95, NULL)->>'already')::boolean,
  (public.record_attendance(:'SOPEN', :'STU1', 0.95, NULL))::text);

SELECT q.eq('D','D-05b','จำนวนแถวของคนที่สแกนซ้ำต้องยังเป็น 1','มี 1 แถว',
  (SELECT count(*) FROM public.attendance_records
    WHERE session_id = :'SOPEN' AND student_id = :'STU1'), 1::bigint);

SELECT q.eq('D','D-05c','สถานะเดิมต้องไม่ถูกเปลี่ยนเพราะการสแกนซ้ำ','ยังเป็น on_time',
  (SELECT status FROM public.attendance_records
    WHERE session_id = :'SOPEN' AND student_id = :'STU1'), 'on_time');

-- ───────────────────────────────────────────────────────────────────────────
-- D-07 นาฬิกาของอุปกรณ์ผิดไป 2 วัน เวลาที่บันทึกต้องยังถูกต้อง
--   record_attendance ใช้ now() ของเซิร์ฟเวอร์เสมอ ไม่รับเวลาจากผู้เรียก
--   จึงพิสูจน์ได้ว่าไม่มีช่องให้ส่งเวลาปลอมเข้ามา
-- ───────────────────────────────────────────────────────────────────────────
SELECT q.ok('D','D-07a','ฟังก์ชันเช็คชื่อไม่มีพารามิเตอร์รับเวลาจากอุปกรณ์',
  'พารามิเตอร์มีแค่ session, student, confidence, photo',
  (SELECT pg_get_function_arguments(p.oid) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='record_attendance') NOT LIKE '%timestamp%',
  (SELECT pg_get_function_arguments(p.oid) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='record_attendance'));

SELECT q.ok('D','D-07b','เวลาที่บันทึกต้องเป็นเวลาของเซิร์ฟเวอร์ ไม่ใช่เวลาที่ส่งมา',
  'checked_in_at ห่างจากเวลาเซิร์ฟเวอร์ไม่เกิน 1 นาที',
  (SELECT abs(extract(epoch FROM (now() - checked_in_at))) < 60
     FROM public.attendance_records WHERE session_id = :'SOPEN' AND student_id = :'STU1'),
  (SELECT 'ห่าง ' || round(abs(extract(epoch FROM (now() - checked_in_at)))) || ' วินาที'
     FROM public.attendance_records WHERE session_id = :'SOPEN' AND student_id = :'STU1'));

-- ───────────────────────────────────────────────────────────────────────────
-- D-08 ปิดคาบเรียน ผู้ไม่เช็คชื่อต้องได้สถานะขาดเรียน
--   ในคาบนี้ STU1 มาตรงเวลา STU2 มาสาย เหลือ STU3 STU4 ที่ยังไม่เช็คชื่อ
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
UPDATE public.class_sessions SET status = 'closed', closed_at = now() WHERE id = :'SOPEN';
INSERT INTO public.attendance_records (session_id, student_id, status)
SELECT :'SOPEN', ce.student_id, 'absent'
FROM public.course_enrollments ce
WHERE ce.course_id = :'COURSE' AND ce.status = 'confirmed'
  AND NOT EXISTS (SELECT 1 FROM public.attendance_records ar
                   WHERE ar.session_id = :'SOPEN' AND ar.student_id = ce.student_id);
SELECT q.act_as(:'INS');
SET ROLE authenticated;

SELECT q.eq('D','D-08a','ปิดคาบแล้ว คนที่ไม่เช็คชื่อต้องได้สถานะขาดเรียน','ขาด 2 คน (STU3, STU4)',
  (SELECT count(*) FROM public.attendance_records
    WHERE session_id = :'SOPEN' AND status = 'absent'), 2::bigint);
SELECT q.eq('D','D-08b','ทุกคนในรายวิชาต้องมีระเบียนของคาบนี้ครบ','4 แถว',
  (SELECT count(*) FROM public.attendance_records WHERE session_id = :'SOPEN'), 4::bigint);

-- ───────────────────────────────────────────────────────────────────────────
-- D-09 ยกเลิกคาบเรียนที่ยังไม่มีใครเช็คชื่อ ต้องไม่มีใครถูกบันทึกว่าขาด
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
INSERT INTO public.class_sessions
  (id, course_id, instructor_id, started_at, status, late_after_minutes)
VALUES ('33333333-3333-4333-8333-333333330098', :'COURSE', :'INS', now(), 'open', 15);
SELECT q.act_as(:'INS');
SET ROLE authenticated;

SELECT q.runs('D','D-09a','ยกเลิกคาบที่ยังไม่มีใครเช็คชื่อ','ยกเลิกสำเร็จ',
  format('SELECT public.cancel_class_session(%L::uuid, %L, ''keep'')',
         '33333333-3333-4333-8333-333333330098', 'TEST_อาจารย์ติดประชุม'));
SELECT q.eq('D','D-09b','คาบที่ยกเลิกต้องไม่มีใครถูกบันทึกว่าขาด','0 แถว',
  (SELECT count(*) FROM public.attendance_records
    WHERE session_id = '33333333-3333-4333-8333-333333330098'), 0::bigint);
SELECT q.eq('D','D-09c','คาบที่ยกเลิกต้องไม่ถูกนับเป็นคะแนน','counts_for_grade = false',
  (SELECT counts_for_grade FROM public.class_sessions
    WHERE id = '33333333-3333-4333-8333-333333330098'), false);

-- ───────────────────────────────────────────────────────────────────────────
-- D-10 ยกเลิกคาบหลังมีคนเช็คชื่อแล้ว ต้องถามว่าจะทำอย่างไรกับระเบียนเดิม
--   RPC รับพารามิเตอร์ _records = keep / delete / excuse จึงพิสูจน์ว่า
--   ระบบ "ให้เลือก" ได้จริง และแต่ละตัวเลือกให้ผลต่างกัน
-- ───────────────────────────────────────────────────────────────────────────
SELECT q.ok('D','D-10a','ฟังก์ชันยกเลิกคาบต้องมีตัวเลือกจัดการระเบียนเดิม',
  'มีพารามิเตอร์ _records ให้เลือก',
  (SELECT pg_get_function_arguments(p.oid) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='cancel_class_session') LIKE '%_records%',
  (SELECT pg_get_function_arguments(p.oid) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='cancel_class_session'));

SELECT q.raises('D','D-10b','ยกเลิกคาบโดยส่งตัวเลือกจัดการระเบียนที่ไม่รู้จัก','ต้องถูกปฏิเสธ',
  format('SELECT public.cancel_class_session(%L::uuid, %L, ''excuse'')',
         :'SOPEN', 'TEST_ส่งตัวเลือกที่ไม่มีอยู่จริง'),
  'เก็บระเบียน');
SELECT q.runs('D','D-10c','ยกเลิกคาบที่มีคนเช็คชื่อแล้ว โดยเลือกลบระเบียนทิ้ง','ทำได้',
  format('SELECT public.cancel_class_session(%L::uuid, %L, ''delete'')',
         :'SOPEN', 'TEST_ยกเลิกย้อนหลังหลังมีคนเช็คชื่อ'));
SELECT q.eq('D','D-10d','เลือก delete แล้วระเบียนเดิมต้องถูกลบหมด','0 แถว',
  (SELECT count(*) FROM public.attendance_records WHERE session_id = :'SOPEN'), 0::bigint);

-- ───────────────────────────────────────────────────────────────────────────
-- D-11 อาจารย์แก้สถานะย้อนหลังโดยไม่ระบุเหตุผล ต้องบันทึกไม่ได้
-- ───────────────────────────────────────────────────────────────────────────
SELECT q.raises('D','D-11','แก้สถานะการเข้าเรียนย้อนหลังโดยไม่ระบุเหตุผล','ต้องถูกปฏิเสธ',
  format($f$UPDATE public.attendance_records SET status = 'on_time', edited_by = %L::uuid,
             edited_at = now() WHERE session_id = %L::uuid AND student_id = %L::uuid$f$,
         :'INS', :'SOPEN', :'STU3'),
  'เหตุผล');

-- ───────────────────────────────────────────────────────────────────────────
-- D-12 อนุมัติใบลา สถานะของวันนั้นต้องเปลี่ยนเป็นลา
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
-- คาบปิดแล้วที่ STU3 ขาด (คาบที่ 9)
UPDATE public.attendance_records SET status = 'absent'
 WHERE session_id = '33333333-3333-4333-8333-333333330009' AND student_id = :'STU3';
INSERT INTO public.attendance_records (session_id, student_id, status)
SELECT '33333333-3333-4333-8333-333333330009', :'STU3', 'absent'
WHERE NOT EXISTS (SELECT 1 FROM public.attendance_records
                   WHERE session_id = '33333333-3333-4333-8333-333333330009'
                     AND student_id = :'STU3');
INSERT INTO public.leave_requests
  (id, student_id, course_id, session_id, leave_type, leave_date, reason, status)
VALUES ('88888888-8888-4888-8888-888888880001', :'STU3', :'COURSE',
        '33333333-3333-4333-8333-333333330009', 'sick',
        (SELECT started_at::date FROM public.class_sessions
          WHERE id = '33333333-3333-4333-8333-333333330009'),
        'TEST_ป่วยมีใบรับรองแพทย์', 'pending');
SELECT q.act_as(:'INS');
SET ROLE authenticated;

UPDATE public.leave_requests
   SET status = 'approved', reviewed_by = :'INS', reviewed_at = now()
 WHERE id = '88888888-8888-4888-8888-888888880001';

SELECT q.eq('D','D-12','อนุมัติใบลาแล้ว สถานะการเข้าเรียนของคาบนั้นต้องเปลี่ยนเป็นลา','excused',
  (SELECT status FROM public.attendance_records
    WHERE session_id = '33333333-3333-4333-8333-333333330009' AND student_id = :'STU3'),
  'excused');

-- ───────────────────────────────────────────────────────────────────────────
-- D-13 ขาดครบ 4 ครั้ง ต้องถูกระงับสิทธิ์และได้รับแจ้งเตือน
-- D-14 อนุมัติใบลาย้อนหลังจนขาดเหลือ 3 ครั้ง ต้องปลดระงับสิทธิ์ให้เอง
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
DELETE FROM public.notifications WHERE user_id = :'STU4';
-- ทำให้ STU4 ขาด 4 คาบพอดี (คาบ 7-10)
UPDATE public.attendance_records SET status = 'on_time'
 WHERE student_id = :'STU4';
DELETE FROM public.attendance_records WHERE student_id = :'STU4'
   AND session_id IN ('33333333-3333-4333-8333-333333330007',
                      '33333333-3333-4333-8333-333333330008',
                      '33333333-3333-4333-8333-333333330009',
                      '33333333-3333-4333-8333-333333330010');
INSERT INTO public.attendance_records (session_id, student_id, status) VALUES
  ('33333333-3333-4333-8333-333333330007', :'STU4', 'absent'),
  ('33333333-3333-4333-8333-333333330008', :'STU4', 'absent'),
  ('33333333-3333-4333-8333-333333330009', :'STU4', 'absent'),
  ('33333333-3333-4333-8333-333333330010', :'STU4', 'absent');
SELECT q.act_as(:'INS');
SET ROLE authenticated;

SELECT q.eq('D','D-13a','ขาดครบ 4 ครั้ง จำนวนครั้งที่ขาดต้องถูกนับไว้','absent_count = 4',
  (SELECT absent_count FROM public.course_enrollments
    WHERE course_id = :'COURSE' AND student_id = :'STU4'), 4);
SELECT q.ok('D','D-13b','ขาดครบ 4 ครั้ง ต้องถูกระงับสิทธิ์','attendance_blocked = true',
  (SELECT attendance_blocked FROM public.course_enrollments
    WHERE course_id = :'COURSE' AND student_id = :'STU4'),
  (SELECT attendance_blocked::text FROM public.course_enrollments
    WHERE course_id = :'COURSE' AND student_id = :'STU4'));
-- อ่านตารางแจ้งเตือนในฐานะ postgres เพราะ RLS ให้เจ้าของเท่านั้นที่เห็น
-- ถ้าอ่านในฐานะอาจารย์จะได้ 0 แถวเสมอ แล้วเราจะสรุปผิดว่าระบบไม่แจ้งเตือน
RESET ROLE;
SELECT q.ok('D','D-13c','ถูกระงับสิทธิ์แล้วต้องได้รับการแจ้งเตือน','มีแถวแจ้งเตือนของ STU4',
  EXISTS (SELECT 1 FROM public.notifications WHERE user_id = :'STU4'),
  COALESCE((SELECT string_agg(DISTINCT title, ' | ') FROM public.notifications
             WHERE user_id = :'STU4'), 'ไม่มีการแจ้งเตือน'));
SELECT q.act_as(:'INS'); SET ROLE authenticated;
SELECT q.eq('D','D-13d','คนที่ถูกระงับสิทธิ์ต้องไม่อยู่ในรายชื่อที่ส่งให้อุปกรณ์สแกน',
  'ไม่มี STU4 ในรายชื่อ',
  (SELECT count(*) FROM public.get_scan_roster(:'COURSE') r WHERE r.student_id = :'STU4'),
  0::bigint);

-- อนุมัติใบลาย้อนหลัง 1 คาบ → ขาดเหลือ 3 → ต้องปลดระงับเอง
RESET ROLE;
UPDATE public.attendance_records SET status = 'excused'
 WHERE session_id = '33333333-3333-4333-8333-333333330007' AND student_id = :'STU4';
SELECT q.act_as(:'INS');
SET ROLE authenticated;

SELECT q.eq('D','D-14a','อนุมัติลาย้อนหลัง 1 คาบ จำนวนที่ขาดต้องลดเหลือ 3','absent_count = 3',
  (SELECT absent_count FROM public.course_enrollments
    WHERE course_id = :'COURSE' AND student_id = :'STU4'), 3);
SELECT q.ok('D','D-14b','ขาดเหลือ 3 ครั้ง ต้องปลดระงับสิทธิ์ให้เอง','attendance_blocked = false',
  (SELECT NOT attendance_blocked FROM public.course_enrollments
    WHERE course_id = :'COURSE' AND student_id = :'STU4'),
  (SELECT attendance_blocked::text FROM public.course_enrollments
    WHERE course_id = :'COURSE' AND student_id = :'STU4'));
SELECT q.eq('D','D-14c','ปลดระงับแล้วต้องกลับเข้ารายชื่อที่ส่งให้อุปกรณ์สแกน','มี STU4 ในรายชื่อ',
  (SELECT count(*) FROM public.get_scan_roster(:'COURSE') r WHERE r.student_id = :'STU4'),
  1::bigint);

RESET ROLE;
