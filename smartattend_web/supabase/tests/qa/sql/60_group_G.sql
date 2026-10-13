-- ═══════════════════════════════════════════════════════════════════════════
--  กลุ่ม G — ความปลอดภัยระดับฐานข้อมูล
--
--  ทุกข้อรันในฐานะ authenticated/anon จริง ไม่ใช่ postgres
--  เพราะ postgres เป็น superuser ที่ข้าม RLS ทุกนโยบาย ถ้ารันผิด role
--  เทสต์จะผ่านหมดโดยไม่ได้ทดสอบอะไรเลย
--
--  G-01 (เรียก Edge Function โดยไม่มีสิทธิ์) ทดสอบที่นี่ไม่ได้ เพราะ Edge
--  Function เป็นบริการ Deno แยกต่างหาก ไม่ได้อยู่ในฐานข้อมูล
--  ดูขั้นตอนทดสอบด้วยมือใน docs/รายการตรวจสอบด้วยมือ.md
-- ═══════════════════════════════════════════════════════════════════════════
\set INS    '11111111-1111-4111-8111-111111111102'
\set INS2   '11111111-1111-4111-8111-111111111103'
\set STU1   '11111111-1111-4111-8111-111111111201'
\set STU2   '11111111-1111-4111-8111-111111111202'
\set COURSE '22222222-2222-4222-8222-222222222201'
\set COURSE2 '22222222-2222-4222-8222-222222222202'
\set LAB1   '55555555-5555-4555-8555-555555550001'

-- ───────────────────────────────────────────────────────────────────────────
-- G-02 นักศึกษาเรียกดูข้อมูลของนักศึกษาคนอื่น ต้องได้ผลลัพธ์ว่าง
-- ───────────────────────────────────────────────────────────────────────────
SELECT q.act_as(:'STU1');
SET ROLE authenticated;

SELECT q.eq('G','G-02a','นักศึกษาอ่านคะแนนของเพื่อนร่วมชั้น','ได้ 0 แถว',
  (SELECT count(*) FROM public.student_grades WHERE student_id = :'STU2'), 0::bigint);
SELECT q.eq('G','G-02b','นักศึกษาอ่านโปรไฟล์ของเพื่อนร่วมชั้น','ได้ 0 แถว',
  (SELECT count(*) FROM public.profiles WHERE user_id = :'STU2'), 0::bigint);
SELECT q.eq('G','G-02c','นักศึกษาอ่านประวัติการเข้าเรียนของเพื่อนร่วมชั้น','ได้ 0 แถว',
  (SELECT count(*) FROM public.attendance_records WHERE student_id = :'STU2'), 0::bigint);
SELECT q.eq('G','G-02d','นักศึกษาอ่านสถานะการลงทะเบียนใบหน้าของคนอื่น','ได้ 0 แถว',
  (SELECT count(*) FROM public.registration_statuses WHERE user_id = :'STU2'), 0::bigint);
SELECT q.eq('G','G-02e','นักศึกษาอ่านบันทึกการใช้งานของระบบ (audit_logs)','ได้ 0 แถว',
  (SELECT count(*) FROM public.audit_logs), 0::bigint);
SELECT q.eq('G','G-02f','นักศึกษาอ่านประวัติการแก้คะแนนทั้งระบบ','ได้ 0 แถว',
  (SELECT count(*) FROM public.grade_audit_logs), 0::bigint);
SELECT q.eq('G','G-02g','นักศึกษาเห็นข้อมูลของตัวเองได้ตามปกติ (ตรวจว่า RLS ไม่ได้ปิดหมด)',
  'ได้ 1 แถว',
  (SELECT count(*) FROM public.profiles WHERE user_id = :'STU1'), 1::bigint);

-- นักศึกษาขอรายชื่อทั้งห้องผ่าน RPC ที่เป็น SECURITY DEFINER
SELECT q.eq('G','G-02h','นักศึกษาเรียก get_scan_roster เพื่อขอรายชื่อทั้งห้อง',
  'ต้องได้ 0 แถว เพราะไม่ใช่อาจารย์ของรายวิชา',
  (SELECT count(*) FROM public.get_scan_roster(:'COURSE')), 0::bigint);

-- นักศึกษาขอรายชื่อของ "รายวิชาที่ตัวเองไม่ได้ลงทะเบียน"
SELECT q.eq('G','G-02i','นักศึกษาเรียก get_scan_roster ของรายวิชาที่ไม่ได้ลงทะเบียน',
  'ต้องได้ 0 แถว',
  (SELECT count(*) FROM public.get_scan_roster(:'COURSE2')), 0::bigint);

-- นักศึกษาแก้คะแนนตัวเอง
--   PostgreSQL ไม่ throw error เมื่อ USING ของ RLS กรองแถวออกหมด แต่จะ
--   "ไม่กระทบแถวใดเลย" เงียบ ๆ จึงต้องตรวจค่าจริงหลังสั่ง ไม่ใช่ตรวจว่า error
RESET ROLE;
UPDATE public.student_grades SET score = 10
 WHERE grade_item_id = :'LAB1' AND student_id = :'STU1';    -- ตั้งค่าตั้งต้นให้แน่ชัด
SELECT q.act_as(:'STU1');
SET ROLE authenticated;
UPDATE public.student_grades SET score = 3
 WHERE grade_item_id = :'LAB1' AND student_id = :'STU1';
RESET ROLE;
SELECT q.eq('G','G-02j','นักศึกษาพยายามแก้คะแนนของตัวเองเป็น 3','คะแนนต้องยังเป็น 10 เท่าเดิม',
  (SELECT score FROM public.student_grades
    WHERE grade_item_id = :'LAB1' AND student_id = :'STU1'), 10::numeric);
SELECT q.act_as(:'STU1');
SET ROLE authenticated;

-- นักศึกษายกระดับสิทธิ์ตัวเองเป็นผู้ดูแลระบบ
SELECT q.raises('G','G-02k','นักศึกษาพยายามเพิ่มบทบาท admin ให้ตัวเอง','ต้องถูกปฏิเสธ',
  format('INSERT INTO public.user_roles (user_id, role) VALUES (%L::uuid, ''admin'')', :'STU1'),
  'row-level security');

-- ───────────────────────────────────────────────────────────────────────────
-- G-03 อาจารย์เรียกดูข้อมูลของรายวิชาที่ไม่ได้สอน ต้องได้ผลลัพธ์ว่าง
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
SELECT q.act_as(:'INS2');       -- อาจารย์ของ TEST_ENGCE999 ไม่ใช่ของ TEST_ENGCE101
SET ROLE authenticated;

SELECT q.eq('G','G-03a','อาจารย์อ่านคะแนนของรายวิชาที่ไม่ได้สอน','ได้ 0 แถว',
  (SELECT count(*) FROM public.student_grades sg
    JOIN public.grade_items gi ON gi.id = sg.grade_item_id
   WHERE gi.course_id = :'COURSE'), 0::bigint);
SELECT q.eq('G','G-03b','อาจารย์อ่านหัวข้อคะแนนของรายวิชาที่ไม่ได้สอน','ได้ 0 แถว',
  (SELECT count(*) FROM public.grade_items WHERE course_id = :'COURSE'), 0::bigint);
SELECT q.eq('G','G-03c','อาจารย์อ่านรายชื่อนักศึกษาของรายวิชาที่ไม่ได้สอน','ได้ 0 แถว',
  (SELECT count(*) FROM public.course_enrollments WHERE course_id = :'COURSE'), 0::bigint);
SELECT q.eq('G','G-03d','อาจารย์อ่านประวัติการเข้าเรียนของรายวิชาที่ไม่ได้สอน','ได้ 0 แถว',
  (SELECT count(*) FROM public.attendance_records ar
    JOIN public.class_sessions cs ON cs.id = ar.session_id
   WHERE cs.course_id = :'COURSE'), 0::bigint);
SELECT q.eq('G','G-03e','อาจารย์เรียก get_scan_roster ของรายวิชาที่ไม่ได้สอน','ต้องได้ 0 แถว',
  (SELECT count(*) FROM public.get_scan_roster(:'COURSE')), 0::bigint);
SELECT q.raises('G','G-03f','อาจารย์สั่งคำนวณคะแนนเข้าเรียนของรายวิชาที่ไม่ได้สอน','ต้องถูกปฏิเสธ',
  format('SELECT public.recalc_attendance_scores(%L::uuid)', :'COURSE'), 'สิทธิ์');
SELECT q.raises('G','G-03g','อาจารย์สั่งประกาศผลของรายวิชาที่ไม่ได้สอน','ต้องถูกปฏิเสธ',
  format('SELECT public.publish_final_grades(%L::uuid, true, %L, ''[]''::jsonb)',
         :'COURSE', 'TEST_แอบประกาศ'), 'สิทธิ์');
SELECT q.raises('G','G-03h','อาจารย์แก้คะแนนของรายวิชาที่ไม่ได้สอน','ต้องถูกปฏิเสธ',
  format('SELECT public.save_student_grades(%L::uuid, %s::jsonb, %L)', :'COURSE',
    quote_literal(jsonb_build_array(jsonb_build_object(
      'grade_item_id', :'LAB1', 'student_id', :'STU1', 'score', 1))::text),
    'TEST_แอบแก้'), 'สิทธิ์');

-- ───────────────────────────────────────────────────────────────────────────
-- G-06 ผู้ใช้ที่ยังไม่ล็อกอิน (anon) ต้องไม่เห็นอะไรเลย
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
SELECT q.act_as_anon();
SET ROLE anon;

SELECT q.eq('G','G-06a','ผู้ใช้ที่ยังไม่ล็อกอินอ่านตารางโปรไฟล์','ได้ 0 แถว',
  (SELECT count(*) FROM public.profiles), 0::bigint);
SELECT q.eq('G','G-06b','ผู้ใช้ที่ยังไม่ล็อกอินอ่านตารางคะแนน','ได้ 0 แถว',
  (SELECT count(*) FROM public.student_grades), 0::bigint);
SELECT q.eq('G','G-06c','ผู้ใช้ที่ยังไม่ล็อกอินอ่านรายวิชา','ได้ 0 แถว',
  (SELECT count(*) FROM public.courses), 0::bigint);
SELECT q.eq('G','G-06d','ผู้ใช้ที่ยังไม่ล็อกอินเรียก get_scan_roster ขอรายชื่อทั้งห้อง',
  'ต้องได้ 0 แถว',
  (SELECT count(*) FROM public.get_scan_roster(:'COURSE')), 0::bigint);
SELECT q.raises('G','G-06e','ผู้ใช้ที่ยังไม่ล็อกอินเรียกสรุปคะแนนของนักศึกษา','ต้องถูกปฏิเสธ',
  format('SELECT public.get_student_score_summary(%L::uuid, %L::uuid)', :'COURSE', :'STU1'),
  'permission denied');

RESET ROLE;
