-- ═══════════════════════════════════════════════════════════════════════════
--  กลุ่ม C — รายวิชาและรายชื่อ (UC-06)
--  การนำเข้าไฟล์ตารางคำนวณทำที่ Edge Function import-course-roster
--  ซึ่งเรียกจากที่นี่ไม่ได้ ข้อ C-01/C-02/C-03 จึงทดสอบ "ผลลัพธ์ที่ต้องได้"
--  ในตารางแทน และมีขั้นตอนทดสอบผ่านหน้าจอใน docs/รายการตรวจสอบด้วยมือ.md
-- ═══════════════════════════════════════════════════════════════════════════
\set INS    '11111111-1111-4111-8111-111111111102'
\set STU1   '11111111-1111-4111-8111-111111111201'
\set STU4   '11111111-1111-4111-8111-111111111204'
\set COURSE '22222222-2222-4222-8222-222222222201'

SELECT q.act_as(:'INS');
SET ROLE authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- C-02 แถวที่จับคู่บัญชีไม่ได้ ต้องค้างเป็นสถานะรอจับคู่ ไม่ใช่หายไปเฉย ๆ
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
INSERT INTO public.course_enrollments
  (id, course_id, student_id, student_code_raw, student_name_raw, status)
VALUES ('22222222-2222-4222-8222-222222229001', :'COURSE', NULL,
        'TEST_รหัสผิดรูปแบบ-xyz', 'TEST_นักศึกษาที่จับคู่ไม่ได้', 'unmatched');
SELECT q.act_as(:'INS');
SET ROLE authenticated;

SELECT q.eq('C','C-02a','แถวที่จับคู่รหัสนักศึกษาไม่ได้ ต้องยังอยู่ในระบบ','มี 1 แถว',
  (SELECT count(*) FROM public.course_enrollments
    WHERE course_id = :'COURSE' AND status = 'unmatched'), 1::bigint);
SELECT q.eq('C','C-02b','แถวที่จับคู่ไม่ได้ต้องเก็บข้อมูลดิบไว้ให้จับคู่ภายหลัง','เก็บรหัสและชื่อดิบไว้',
  (SELECT student_code_raw FROM public.course_enrollments
    WHERE id = '22222222-2222-4222-8222-222222229001'), 'TEST_รหัสผิดรูปแบบ-xyz');
SELECT q.ok('C','C-02c','แถวที่จับคู่ไม่ได้ต้องยังไม่ผูกกับบัญชีใด','student_id เป็น NULL',
  (SELECT student_id FROM public.course_enrollments
    WHERE id = '22222222-2222-4222-8222-222222229001') IS NULL, 'NULL');

-- ───────────────────────────────────────────────────────────────────────────
-- C-04 นักศึกษายืนยันเข้าร่วมรายวิชา สถานะต้องเปลี่ยนเป็นยืนยันแล้ว
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
UPDATE public.course_enrollments SET status = 'pending', confirmed_at = NULL
 WHERE course_id = :'COURSE' AND student_id = :'STU1';
SELECT q.act_as(:'STU1');
SET ROLE authenticated;

UPDATE public.course_enrollments SET status = 'confirmed', confirmed_at = now()
 WHERE course_id = :'COURSE' AND student_id = :'STU1';

SELECT q.eq('C','C-04','นักศึกษากดยืนยันเข้าร่วมรายวิชา','สถานะเปลี่ยนเป็น confirmed',
  (SELECT status FROM public.course_enrollments
    WHERE course_id = :'COURSE' AND student_id = :'STU1'), 'confirmed');

-- ───────────────────────────────────────────────────────────────────────────
-- C-05 นักศึกษาที่ยังไม่ยืนยัน ต้องไม่ถูกส่งไปยังคลังใบหน้าของอุปกรณ์
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
UPDATE public.course_enrollments SET status = 'pending', confirmed_at = NULL
 WHERE course_id = :'COURSE' AND student_id = :'STU4';
SELECT q.act_as(:'INS');
SET ROLE authenticated;

SELECT q.eq('C','C-05a','นักศึกษาที่ยังไม่ยืนยันต้องไม่อยู่ในรายชื่อที่ส่งให้อุปกรณ์','ไม่พบ STU4',
  (SELECT count(*) FROM public.get_scan_roster(:'COURSE') r WHERE r.student_id = :'STU4'),
  0::bigint);
SELECT q.eq('C','C-05b','แถวที่จับคู่บัญชีไม่ได้ต้องไม่อยู่ในรายชื่อที่ส่งให้อุปกรณ์ด้วย',
  'รายชื่อมีเฉพาะคนที่ยืนยันแล้วและมีบัญชี',
  (SELECT count(*) FROM public.get_scan_roster(:'COURSE')), 3::bigint);

RESET ROLE;
UPDATE public.course_enrollments SET status = 'confirmed', confirmed_at = now()
 WHERE course_id = :'COURSE' AND student_id = :'STU4';
