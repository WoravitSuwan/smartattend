-- ═══════════════════════════════════════════════════════════════════════════
--  กลุ่ม F — คะแนน การปิดบัง และการประกาศผล (UC-15 ถึง UC-18)
--
--  ทุกข้อรันในฐานะ authenticated พร้อม auth.uid() จริง ไม่ใช่ postgres
--  เพราะ postgres เป็น superuser ที่ข้าม RLS ทุกนโยบาย
-- ═══════════════════════════════════════════════════════════════════════════
\set INS   '11111111-1111-4111-8111-111111111102'
\set INS2  '11111111-1111-4111-8111-111111111103'
\set STU1  '11111111-1111-4111-8111-111111111201'
\set STU2  '11111111-1111-4111-8111-111111111202'
\set STU3  '11111111-1111-4111-8111-111111111203'
\set STU4  '11111111-1111-4111-8111-111111111204'
\set COURSE '22222222-2222-4222-8222-222222222201'
\set CATT  '44444444-4444-4444-8444-444444440001'
\set CFINAL '44444444-4444-4444-8444-444444440005'
\set LAB1  '55555555-5555-4555-8555-555555550001'
\set IFINAL '55555555-5555-4555-8555-555555550004'

-- ───────────────────────────────────────────────────────────────────────────
-- F-01 เกณฑ์คะแนนเข้าเรียน มาสายได้ 0.5 — เทียบกับการคำนวณด้วยมือ
--   คาบที่นับ 10 คาบ (ยกเลิก 2 คาบไม่นับ)
--   STU1 10/10 = 1.00 · STU2 (8+1)/10 = 0.90 · STU3 7.5/10 = 0.75 · STU4 5/10 = 0.50
-- ───────────────────────────────────────────────────────────────────────────
SELECT q.act_as(:'INS');
SET ROLE authenticated;

SELECT q.eq('F','F-01a','คะแนนเข้าเรียน STU1 (ตรงเวลา 10 คาบ)','ได้ 1.000000 เท่ากับคำนวณด้วยมือ',
  (public.attendance_score_detail(:'CATT', :'STU1')->>'ratio')::numeric, 1.000000::numeric);
SELECT q.eq('F','F-01b','คะแนนเข้าเรียน STU2 (ตรงเวลา 8 สาย 2 สายได้ 0.5)','ได้ 0.900000',
  (public.attendance_score_detail(:'CATT', :'STU2')->>'ratio')::numeric, 0.900000::numeric);
SELECT q.eq('F','F-01c','คะแนนเข้าเรียน STU3 (ตรงเวลา 6 สาย 1 ลา 1 ขาด 2)','ได้ 0.750000',
  (public.attendance_score_detail(:'CATT', :'STU3')->>'ratio')::numeric, 0.750000::numeric);
SELECT q.eq('F','F-01d','คะแนนเข้าเรียน STU4 (ตรงเวลา 5 ขาด 5)','ได้ 0.500000',
  (public.attendance_score_detail(:'CATT', :'STU4')->>'ratio')::numeric, 0.500000::numeric);
SELECT q.eq('F','F-01e','คะแนนที่คิดเป็นน้ำหนักหมวด 10% ของ STU3','ได้ 7.5 จาก 10',
  (public.attendance_score_detail(:'CATT', :'STU3')->>'earned')::numeric, 7.5000::numeric);

-- ───────────────────────────────────────────────────────────────────────────
-- F-02 เปลี่ยนเกณฑ์มาสายเป็น 1.0 แล้วคะแนนของทุกคนต้องเปลี่ยนตาม
--   STU2 (8+2)/10 = 1.00 · STU3 (6+1+1)/10 = 0.80 · STU1/STU4 ไม่เปลี่ยน
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
UPDATE public.grade_components SET credit_late = 1.0 WHERE id = :'CATT';
SET ROLE authenticated;

SELECT q.eq('F','F-02a','เปลี่ยนเกณฑ์มาสายเป็น 1.0 แล้ว STU2','ได้ 1.000000 จากเดิม 0.900000',
  (public.attendance_score_detail(:'CATT', :'STU2')->>'ratio')::numeric, 1.000000::numeric);
SELECT q.eq('F','F-02b','เปลี่ยนเกณฑ์มาสายเป็น 1.0 แล้ว STU3','ได้ 0.800000 จากเดิม 0.750000',
  (public.attendance_score_detail(:'CATT', :'STU3')->>'ratio')::numeric, 0.800000::numeric);
SELECT q.eq('F','F-02c','คนที่ไม่เคยมาสายต้องไม่เปลี่ยน (STU4)','ยังได้ 0.500000 เท่าเดิม',
  (public.attendance_score_detail(:'CATT', :'STU4')->>'ratio')::numeric, 0.500000::numeric);

RESET ROLE;
UPDATE public.grade_components SET credit_late = 0.5 WHERE id = :'CATT';   -- คืนค่าเดิม
SET ROLE authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- F-03 คาบที่ยกเลิกต้องไม่ถูกนับทั้งตัวตั้งและตัวหาร
--   มี 12 คาบ ยกเลิก 2 → ตัวหารต้องเป็น 10 ไม่ใช่ 12
-- ───────────────────────────────────────────────────────────────────────────
SELECT q.eq('F','F-03a','คาบที่ยกเลิกไม่ถูกนับเป็นตัวหาร','ตัวหาร = 10 (ไม่ใช่ 12)',
  (public.attendance_score_detail(:'CATT', :'STU1')->>'counted_sessions')::int, 10);
SELECT q.eq('F','F-03b','ระบบรายงานจำนวนคาบที่ยกเลิกแยกไว้','บอกว่ายกเลิก 2 คาบ',
  (public.attendance_score_detail(:'CATT', :'STU1')->>'cancelled_sessions')::int, 2);

-- ───────────────────────────────────────────────────────────────────────────
-- F-04 นักศึกษาที่เข้าเรียนกลางภาค ต้องไม่ถูกนับขาดในคาบก่อนวันเข้าร่วม
--   ตั้ง joined_at ของ STU4 เป็นหลังคาบที่ 6 → ต้องนับแค่คาบ 7-10 = 4 คาบ
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
UPDATE public.course_enrollments
   SET joined_at = (SELECT started_at FROM public.class_sessions
                     WHERE id = '33333333-3333-4333-8333-333333330007')
 WHERE course_id = :'COURSE' AND student_id = :'STU4';
SET ROLE authenticated;

SELECT q.eq('F','F-04a','นักศึกษาเข้ากลางภาค นับเฉพาะคาบตั้งแต่วันเข้าร่วม','ตัวหาร = 4 (คาบ 7-10)',
  (public.attendance_score_detail(:'CATT', :'STU4')->>'counted_sessions')::int, 4);
SELECT q.eq('F','F-04b','คาบก่อนเข้าร่วมต้องไม่ถูกนับว่าขาด','ขาด = 4 ไม่ใช่ 9',
  (public.attendance_score_detail(:'CATT', :'STU4')->>'absent')::int, 4);

RESET ROLE;
UPDATE public.course_enrollments SET joined_at = NULL
 WHERE course_id = :'COURSE' AND student_id = :'STU4';
SET ROLE authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- F-05 กรอกคะแนนเกินคะแนนเต็ม ต้องถูกปฏิเสธ "จากฐานข้อมูล" ไม่ใช่แค่หน้าจอ
--   ทดสอบสองทาง: ผ่าน RPC และเขียนตรงเข้าตาราง (เลียนแบบการยิง REST ตรง)
-- ───────────────────────────────────────────────────────────────────────────
SELECT q.raises('F','F-05a','กรอกคะแนนเกินเต็มผ่าน RPC upsert_student_grade',
  'ถูกปฏิเสธพร้อมบอกคะแนนเต็ม',
  format('SELECT public.upsert_student_grade(%L::uuid, %L::uuid, 9999, NULL, %L)',
         :'LAB1', :'STU1', 'TEST_ทดสอบเกินเต็ม'),
  'เกินคะแนนเต็ม');

SELECT q.ok('F','F-05b','กรอกคะแนนเกินเต็มผ่าน RPC save_student_grades',
  'คืน ok=false และไม่บันทึกอะไรเลย',
  (public.save_student_grades(:'COURSE',
     jsonb_build_array(jsonb_build_object('grade_item_id', :'LAB1', 'student_id', :'STU1',
                                          'score', 9999)), 'TEST_เกินเต็ม')->>'ok')::boolean = false,
  (public.save_student_grades(:'COURSE',
     jsonb_build_array(jsonb_build_object('grade_item_id', :'LAB1', 'student_id', :'STU1',
                                          'score', 9999)), 'TEST_เกินเต็ม'))::text);

SELECT q.raises('F','F-05c','เขียนคะแนนเกินเต็มตรงเข้าตาราง (เลียนแบบยิง REST ตรง)',
  'ฐานข้อมูลต้องปฏิเสธ ไม่ใช่รับไว้',
  format('UPDATE public.student_grades SET score = 9999 WHERE grade_item_id = %L::uuid AND student_id = %L::uuid',
         :'LAB1', :'STU1'),
  'เกิน');

-- ───────────────────────────────────────────────────────────────────────────
-- F-06 กรอกคะแนนติดลบ ต้องถูกปฏิเสธ
-- ───────────────────────────────────────────────────────────────────────────
SELECT q.raises('F','F-06a','กรอกคะแนนติดลบผ่าน RPC','ถูกปฏิเสธ',
  format('SELECT public.upsert_student_grade(%L::uuid, %L::uuid, -5, NULL, %L)',
         :'LAB1', :'STU1', 'TEST_ติดลบ'),
  'ติดลบ');
SELECT q.raises('F','F-06b','เขียนคะแนนติดลบตรงเข้าตาราง','CHECK constraint ต้องปฏิเสธ',
  format('UPDATE public.student_grades SET score = -5 WHERE grade_item_id = %L::uuid AND student_id = %L::uuid',
         :'LAB1', :'STU1'),
  'student_grades_score_nonnegative');

-- ───────────────────────────────────────────────────────────────────────────
-- F-07 แก้คะแนนที่บันทึกแล้วโดยไม่ระบุเหตุผล ต้องบันทึกไม่ได้
-- ───────────────────────────────────────────────────────────────────────────
SELECT q.raises('F','F-07a','แก้คะแนนเดิมผ่าน upsert_student_grade โดยไม่ใส่เหตุผล',
  'ต้องถูกปฏิเสธเพราะไม่ได้ระบุเหตุผล',
  format('SELECT public.upsert_student_grade(%L::uuid, %L::uuid, 7, NULL, NULL)', :'LAB1', :'STU1'),
  'เหตุผล');
SELECT q.raises('F','F-07b','แก้คะแนนเดิมผ่าน save_student_grades โดยไม่ใส่เหตุผล',
  'ต้องถูกปฏิเสธเพราะไม่ได้ระบุเหตุผล',
  format('SELECT public.save_student_grades(%L::uuid, %s::jsonb, NULL)', :'COURSE',
    quote_literal(jsonb_build_array(jsonb_build_object(
      'grade_item_id', :'LAB1', 'student_id', :'STU1', 'score', 6))::text)),
  'เหตุผล');

-- ───────────────────────────────────────────────────────────────────────────
-- F-08 แก้คะแนนพร้อมระบุเหตุผล ต้องมีแถวในประวัติพร้อมค่าเดิมและค่าใหม่
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE; SET ROLE authenticated;
SELECT public.upsert_student_grade(:'LAB1', :'STU2', 6, NULL, 'TEST_แก้ตามที่นักศึกษาอุทธรณ์');
SELECT q.ok('F','F-08','แก้คะแนนพร้อมเหตุผลแล้วมีประวัติค่าเดิม→ค่าใหม่',
  'มีแถวประวัติ previous_score=8 new_score=6 พร้อมเหตุผล',
  EXISTS (SELECT 1 FROM public.grade_audit_logs gal
          JOIN public.student_grades sg ON sg.id = gal.student_grade_id
          WHERE sg.grade_item_id = :'LAB1' AND sg.student_id = :'STU2'
            AND gal.previous_score = 8 AND gal.new_score = 6
            AND gal.reason = 'TEST_แก้ตามที่นักศึกษาอุทธรณ์'),
  (SELECT string_agg(format('%s→%s เหตุผล %L', gal.previous_score, gal.new_score, gal.reason), ', ')
   FROM public.grade_audit_logs gal JOIN public.student_grades sg ON sg.id = gal.student_grade_id
   WHERE sg.grade_item_id = :'LAB1' AND sg.student_id = :'STU2'));

-- ───────────────────────────────────────────────────────────────────────────
-- F-09 บันทึกคะแนนทั้งชุดที่มีหนึ่งช่องผิด ต้องไม่บันทึกอะไรเลย และบอกว่าช่องไหนผิด
--   ส่ง 3 แถว แถวที่ 2 เกินคะแนนเต็ม
--
--   ตั้งคะแนนตั้งต้นใหม่ก่อน เพราะข้อ F-05c และ F-07 ที่ไม่ผ่านได้เขียนทับ
--   คะแนนของ STU1 ไปแล้ว ถ้าไม่ตั้งใหม่ ข้อนี้จะไม่ผ่านตามข้อก่อนหน้า
--   ทั้งที่ตัวมันเองอาจทำงานถูก — ต้องแยกผลของแต่ละข้อออกจากกันให้ชัด
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
UPDATE public.student_grades SET score = 10
 WHERE grade_item_id = :'LAB1' AND student_id = :'STU1';
SET ROLE authenticated;
SELECT q.ok('F','F-09a','ชุดคะแนนที่มีหนึ่งช่องผิด ต้องคืน saved = 0',
  'saved=0 และ ok=false',
  (public.save_student_grades(:'COURSE', jsonb_build_array(
      jsonb_build_object('grade_item_id', :'LAB1','student_id', :'STU1','score', 9),
      jsonb_build_object('grade_item_id', :'LAB1','student_id', :'STU2','score', 500),
      jsonb_build_object('grade_item_id', :'LAB1','student_id', :'STU3','score', 7)
    ), 'TEST_ชุดที่มีช่องผิด')->>'saved')::int = 0,
  (public.save_student_grades(:'COURSE', jsonb_build_array(
      jsonb_build_object('grade_item_id', :'LAB1','student_id', :'STU1','score', 9),
      jsonb_build_object('grade_item_id', :'LAB1','student_id', :'STU2','score', 500),
      jsonb_build_object('grade_item_id', :'LAB1','student_id', :'STU3','score', 7)
    ), 'TEST_ชุดที่มีช่องผิด'))::text);

SELECT q.ok('F','F-09b','ต้องบอกได้ว่าช่องไหนผิดและผิดเพราะอะไร',
  'errors ระบุ student_id และเหตุผล "เกินคะแนนเต็ม"',
  (public.save_student_grades(:'COURSE', jsonb_build_array(
      jsonb_build_object('grade_item_id', :'LAB1','student_id', :'STU2','score', 500)
    ), 'TEST_ชุดที่มีช่องผิด')->'errors'->0->>'reason') LIKE '%เกินคะแนนเต็ม%',
  (public.save_student_grades(:'COURSE', jsonb_build_array(
      jsonb_build_object('grade_item_id', :'LAB1','student_id', :'STU2','score', 500)
    ), 'TEST_ชุดที่มีช่องผิด')->'errors'->0)::text);

SELECT q.eq('F','F-09c','คะแนนของแถวที่ถูกต้องในชุดต้องไม่ถูกเขียนลงไป',
  'STU1 ยังเป็น 10 เท่าเดิม ไม่ใช่ 9',
  (SELECT score FROM public.student_grades WHERE grade_item_id = :'LAB1' AND student_id = :'STU1'),
  10::numeric);

-- ───────────────────────────────────────────────────────────────────────────
-- F-10 นักศึกษาเปิดหน้าคะแนนขณะตรวจยังไม่ครบ ต้องไม่เห็นตัวอักษรเกรด
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
SELECT q.act_as(:'STU1');
SET ROLE authenticated;

SELECT q.ok('F','F-10a','ตรวจยังไม่ครบ สรุปคะแนนต้องไม่คืนตัวอักษรเกรด',
  'grade = NULL',
  (public.get_student_score_summary(:'COURSE')->>'grade') IS NULL,
  COALESCE(public.get_student_score_summary(:'COURSE')->>'grade', 'NULL'));
SELECT q.ok('F','F-10b','สรุปคะแนนต้องบอกว่ายังตรวจไม่ครบ',
  'fully_graded = false',
  (public.get_student_score_summary(:'COURSE')->>'fully_graded')::boolean = false,
  (public.get_student_score_summary(:'COURSE')->>'fully_graded'));

-- ───────────────────────────────────────────────────────────────────────────
-- F-11 คะแนนปลายภาคก่อนประกาศผล ต้องเห็นเป็นแม่กุญแจพร้อมน้ำหนักที่ปิดไว้
-- ───────────────────────────────────────────────────────────────────────────
SELECT q.ok('F','F-11a','หมวดสอบปลายภาคต้องถูกทำเครื่องหมายว่าปิดบัง',
  'masked = true',
  (SELECT (c->>'masked')::boolean FROM jsonb_array_elements(
      public.get_student_score_summary(:'COURSE')->'components') c
    WHERE (c->>'component_id') = :'CFINAL'),
  (SELECT c::text FROM jsonb_array_elements(
      public.get_student_score_summary(:'COURSE')->'components') c
    WHERE (c->>'component_id') = :'CFINAL'));

SELECT q.eq('F','F-11b','ต้องบอกน้ำหนักที่ถูกปิดบังไว้ให้นักศึกษารู้','masked_weight = 30',
  (public.get_student_score_summary(:'COURSE')->>'masked_weight')::numeric, 30::numeric);

SELECT q.ok('F','F-11c','คะแนนจริงของหมวดที่ปิดบังต้องไม่หลุดออกมาใน summary',
  'earned ของหมวดปลายภาคต้องเป็น 0 ไม่ใช่ 85',
  (SELECT (c->>'earned')::numeric FROM jsonb_array_elements(
      public.get_student_score_summary(:'COURSE')->'components') c
    WHERE (c->>'component_id') = :'CFINAL') = 0,
  (SELECT (c->>'earned') FROM jsonb_array_elements(
      public.get_student_score_summary(:'COURSE')->'components') c
    WHERE (c->>'component_id') = :'CFINAL'));

-- ───────────────────────────────────────────────────────────────────────────
-- F-12 นักศึกษาเรียกข้อมูลคะแนนปลายภาคตรงจากฐานข้อมูล ต้องได้ผลลัพธ์ว่าง
--   นี่คือข้อที่สำคัญที่สุดของกลุ่มนี้ เพราะเป็นการข้ามหน้าจอไปถาม RLS ตรง ๆ
-- ───────────────────────────────────────────────────────────────────────────
SELECT q.eq('F','F-12a','นักศึกษา SELECT คะแนนปลายภาคของตัวเองตรงจากตาราง',
  'ต้องได้ 0 แถว (RLS ปิดบังไว้)',
  (SELECT count(*) FROM public.student_grades
    WHERE grade_item_id = :'IFINAL' AND student_id = :'STU1'), 0::bigint);

SELECT q.eq('F','F-12b','นักศึกษามองเห็นหัวข้อคะแนนปลายภาคหรือไม่',
  'ต้องได้ 0 แถว',
  (SELECT count(*) FROM public.grade_items WHERE id = :'IFINAL'), 0::bigint);

SELECT q.eq('F','F-12c','นักศึกษาเห็นคะแนน LAB ของตัวเองได้ตามปกติ (ตรวจว่า RLS ไม่ได้ปิดหมด)',
  'ต้องได้ 3 แถว',
  (SELECT count(*) FROM public.student_grades sg
    JOIN public.grade_items gi ON gi.id = sg.grade_item_id
   WHERE gi.component_id = '44444444-4444-4444-8444-444444440002'
     AND sg.student_id = :'STU1'), 3::bigint);

-- ───────────────────────────────────────────────────────────────────────────
-- F-13 กดประกาศผลขณะยังมีช่องคะแนนว่าง ต้องเตือนว่าขาดของใครหมวดไหน
--   ชุดข้อมูลตั้งต้นกรอกคะแนนครบแล้ว จึงต้องลบคะแนนออกหนึ่งช่องให้เกิด
--   "ช่องว่าง" จริงก่อน แล้วค่อยทดสอบ (ลบคะแนนกลางภาคของ STU3)
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
DELETE FROM public.student_grades
 WHERE grade_item_id = '55555555-5555-4555-8555-555555550008' AND student_id = :'STU3';
SELECT q.act_as(:'INS');
SET ROLE authenticated;

SELECT q.ok('F','F-13a','ตรวจความพร้อมก่อนประกาศผล ต้องบอกว่ายังไม่พร้อม',
  'ready = false',
  (public.publish_readiness(:'COURSE')->>'ready')::boolean = false,
  (public.publish_readiness(:'COURSE'))::text);

SELECT q.ok('F','F-13b','ต้องระบุได้ว่าใครขาดคะแนนหมวดไหน',
  'รายงานมีรายชื่อนักศึกษาและหัวข้อที่ยังว่าง',
  (public.publish_readiness(:'COURSE')::text) LIKE '%TEST\_%',
  left((public.publish_readiness(:'COURSE'))::text, 400));

SELECT q.raises('F','F-13c','สั่งประกาศผลทั้งที่ยังกรอกไม่ครบ','ต้องถูกปฏิเสธ',
  format('SELECT public.publish_final_grades(%L::uuid, false, %L, ''[]''::jsonb)',
         :'COURSE', 'TEST_ประกาศผลทั้งที่ยังไม่ครบ'),
  'ครบ');

-- ───────────────────────────────────────────────────────────────────────────
-- F-14 กดประกาศผลเมื่อกรอกครบ นักศึกษาต้องเห็นคะแนนปลายภาคและเกรด
--
--   ตั้งคะแนนกลับเป็นค่าตั้งต้นก่อน เพราะข้อ F-05c และ F-07 ที่ไม่ผ่านได้
--   เขียนทับคะแนนไปแล้ว ถ้าไม่ตั้งใหม่ ยอดรวมจะไม่ตรงกับที่คำนวณด้วยมือ
--
--   ยอดรวมที่คำนวณด้วยมือ (ดูตารางใน 10_seed.sql)
--     STU1 92.10 → A    STU2 76.10 → B+    STU3 66.00 → C+    STU4 43.00 → F
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
INSERT INTO public.student_grades (grade_item_id, student_id, score)   -- คืนช่องที่ F-13 ลบไป
VALUES ('55555555-5555-4555-8555-555555550008', :'STU3', 60)
ON CONFLICT (grade_item_id, student_id) DO UPDATE SET score = 60;
UPDATE public.student_grades SET score = 10
 WHERE grade_item_id IN ('55555555-5555-4555-8555-555555550001',
                         '55555555-5555-4555-8555-555555550002',
                         '55555555-5555-4555-8555-555555550003')
   AND student_id = :'STU1';
UPDATE public.student_grades SET score = v.sc FROM (VALUES
    ('55555555-5555-4555-8555-555555550001'::uuid, 8::numeric),
    ('55555555-5555-4555-8555-555555550002'::uuid, 7::numeric),
    ('55555555-5555-4555-8555-555555550003'::uuid, 9::numeric)
  ) AS v(gi, sc)
 WHERE student_grades.grade_item_id = v.gi AND student_grades.student_id = :'STU2';

SELECT q.act_as(:'INS');
SET ROLE authenticated;

SELECT q.eq('F','F-14a','คะแนนรวมของ STU1 ก่อนประกาศผล (ฝั่งอาจารย์)','92.10 ตรงกับคำนวณด้วยมือ',
  (public.get_student_score_summary(:'COURSE', :'STU1')->>'earned')::numeric, 92.10::numeric);
SELECT q.eq('F','F-14b','คะแนนรวมของ STU4 ก่อนประกาศผล','43.00 ตรงกับคำนวณด้วยมือ',
  (public.get_student_score_summary(:'COURSE', :'STU4')->>'earned')::numeric, 43.00::numeric);
SELECT q.ok('F','F-14c','ตรวจความพร้อมก่อนประกาศผล เมื่อกรอกครบแล้ว','ready = true',
  (public.publish_readiness(:'COURSE')->>'ready')::boolean,
  left((public.publish_readiness(:'COURSE'))::text, 200));

-- ประกาศผลจริง (เรียกครั้งเดียว เก็บผลไว้ตรวจหลายข้อ)
CREATE TEMP TABLE _pub AS
  SELECT public.publish_final_grades(:'COURSE', false, 'TEST_ประกาศผลปลายภาค', '[]'::jsonb) AS r;

SELECT q.eq('F','F-14d','ประกาศผลแล้วต้องบันทึกเกรดให้ครบทั้ง 4 คน','published = 4',
  ((SELECT r FROM _pub)->>'published')::int, 4);
SELECT q.eq('F','F-14e','เกรดที่บันทึกของ STU1','A (จากคะแนน 92.10)',
  (SELECT grade FROM public.course_final_grades
    WHERE course_id = :'COURSE' AND student_id = :'STU1'), 'A');
SELECT q.eq('F','F-14f','เกรดที่บันทึกของ STU4','F (จากคะแนน 43.00)',
  (SELECT grade FROM public.course_final_grades
    WHERE course_id = :'COURSE' AND student_id = :'STU4'), 'F');

RESET ROLE;
SELECT q.act_as(:'STU1');
SET ROLE authenticated;

SELECT q.eq('F','F-14g','ประกาศผลแล้ว นักศึกษาต้องเห็นคะแนนปลายภาคที่เคยถูกปิดบัง','เห็นคะแนน 85',
  (SELECT score FROM public.student_grades
    WHERE grade_item_id = :'IFINAL' AND student_id = :'STU1'), 85::numeric);
SELECT q.eq('F','F-14h','ประกาศผลแล้ว นักศึกษาต้องเห็นตัวอักษรเกรด','grade = A',
  public.get_student_score_summary(:'COURSE')->>'grade', 'A');
SELECT q.ok('F','F-14i','เกรดที่นักศึกษาเห็นต้องเป็นเกรดที่ประกาศแล้ว','grade_is_final = true',
  (public.get_student_score_summary(:'COURSE')->>'grade_is_final')::boolean,
  (public.get_student_score_summary(:'COURSE')->>'grade_is_final'));
SELECT q.ok('F','F-14j','เกรดที่นักศึกษาเห็น ต้องตรงกับเกรดที่บันทึกไว้เป็นทางการ',
  'summary.grade = course_final_grades.grade',
  (public.get_student_score_summary(:'COURSE')->>'grade') IS NOT DISTINCT FROM
  (SELECT grade FROM public.course_final_grades
    WHERE course_id = :'COURSE' AND student_id = :'STU1'),
  format('หน้าจอเห็น %s · บันทึกไว้ %s',
    COALESCE(public.get_student_score_summary(:'COURSE')->>'grade','NULL'),
    COALESCE((SELECT grade FROM public.course_final_grades
               WHERE course_id = :'COURSE' AND student_id = :'STU1'),'NULL')));

-- ───────────────────────────────────────────────────────────────────────────
-- F-15 แก้คะแนนหลังประกาศผลโดยไม่ปลดล็อก ต้องแก้ไม่ได้
--   ทดสอบทั้งผ่าน RPC และเขียนตรงเข้าตาราง (เลียนแบบยิง REST ตรง)
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
SELECT q.act_as(:'INS');
SET ROLE authenticated;

SELECT q.ok('F','F-15a','หลังประกาศผล รายวิชาต้องอยู่ในสถานะล็อก','course_grades_locked = true',
  public.course_grades_locked(:'COURSE'), public.course_grades_locked(:'COURSE')::text);
SELECT q.raises('F','F-15b','แก้คะแนนหลังประกาศผลผ่าน save_student_grades','ถูกปฏิเสธเพราะถูกล็อก',
  format('SELECT public.save_student_grades(%L::uuid, %s::jsonb, %L)', :'COURSE',
    quote_literal(jsonb_build_array(jsonb_build_object(
      'grade_item_id', :'LAB1', 'student_id', :'STU1', 'score', 3))::text),
    'TEST_แก้หลังประกาศ'), 'ล็อก');
SELECT q.raises('F','F-15c','แก้คะแนนหลังประกาศผลผ่าน upsert_student_grade','ถูกปฏิเสธเพราะถูกล็อก',
  format('SELECT public.upsert_student_grade(%L::uuid, %L::uuid, 3, NULL, %L)',
         :'LAB1', :'STU1', 'TEST_แก้หลังประกาศ'), 'ล็อก');
SELECT q.raises('F','F-15d','แก้คะแนนหลังประกาศผลโดยเขียนตรงเข้าตาราง','ถูกปฏิเสธเพราะถูกล็อก',
  format('UPDATE public.student_grades SET score = 3 WHERE grade_item_id = %L::uuid AND student_id = %L::uuid',
         :'LAB1', :'STU1'), 'ล็อก');

-- ───────────────────────────────────────────────────────────────────────────
-- F-16 ปลดล็อกแล้วแก้พร้อมเหตุผล ต้องแจ้งเตือนนักศึกษาที่ได้รับผลกระทบ
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
DELETE FROM public.notifications WHERE user_id = :'STU1';   -- ให้เห็นเฉพาะที่เกิดจากข้อนี้
UPDATE public.student_grades SET score = 10
 WHERE grade_item_id = :'LAB1' AND student_id = :'STU1';     -- คืนค่าที่ F-15d อาจเขียนทับ
SELECT q.act_as(:'INS');
SET ROLE authenticated;

SELECT q.runs('F','F-16a','ปลดล็อกคะแนนพร้อมระบุเหตุผล','ปลดล็อกสำเร็จ',
  format('SELECT public.unlock_course_grades(%L::uuid, %L)', :'COURSE', 'TEST_พบคะแนนกรอกผิดหนึ่งราย'));
SELECT q.ok('F','F-16b','ปลดล็อกแล้วต้องแก้คะแนนได้','saved = 1',
  (public.save_student_grades(:'COURSE', jsonb_build_array(jsonb_build_object(
      'grade_item_id', :'LAB1', 'student_id', :'STU1', 'score', 2)),
      'TEST_แก้หลังปลดล็อก')->>'saved')::int = 1,
  'คะแนน LAB1 ของ STU1 เปลี่ยนจาก 10 เป็น 2');
-- อ่านตารางแจ้งเตือนในฐานะ postgres เพราะ RLS ให้เจ้าของเท่านั้นที่เห็น
RESET ROLE;
SELECT q.ok('F','F-16c','นักศึกษาที่ถูกแก้คะแนนต้องได้รับการแจ้งเตือน',
  'มีแถวแจ้งเตือนของ STU1',
  EXISTS (SELECT 1 FROM public.notifications WHERE user_id = :'STU1'),
  COALESCE((SELECT string_agg(DISTINCT type || ': ' || title, ' | ')
            FROM public.notifications WHERE user_id = :'STU1'), 'ไม่มีการแจ้งเตือน'));
SELECT q.act_as(:'INS'); SET ROLE authenticated;

-- แก้คะแนนหลังประกาศผลให้ "ข้ามเส้นเกรด" เพื่อดูว่าหน้าจอกับทะเบียนตรงกันไหม
--   STU1 คะแนน 92.10 ได้ A · ตัดคะแนนกลางภาคจาก 88 เหลือ 0 จะเสีย 17.6 คะแนน
--   เหลือประมาณ 74.5 ซึ่งตกไปอยู่ช่วงเกรด B
--   เกรดที่ประกาศไว้ใน course_final_grades ยังเป็น A เพราะยังไม่ได้ประกาศผลใหม่
--   ถ้าหน้าจอแสดง B แปลว่านักศึกษาเห็นเกรดที่ไม่ตรงกับที่ส่งทะเบียน
SELECT public.save_student_grades(:'COURSE', jsonb_build_array(jsonb_build_object(
    'grade_item_id','55555555-5555-4555-8555-555555550008','student_id',:'STU1','score',0)),
    'TEST_ตัดคะแนนกลางภาคให้ข้ามเส้นเกรด');

-- แก้คะแนนหลังประกาศผลแล้ว เกรดที่นักศึกษาเห็นยังตรงกับเกรดที่ประกาศไว้หรือไม่
RESET ROLE;
SELECT q.act_as(:'STU1');
SET ROLE authenticated;
SELECT q.ok('F','F-16d','แก้คะแนนหลังประกาศผลแล้ว เกรดบนหน้าจอต้องไม่ขัดกับเกรดที่ประกาศ',
  'summary.grade ต้องเท่ากับ course_final_grades.grade',
  (public.get_student_score_summary(:'COURSE')->>'grade') IS NOT DISTINCT FROM
  (SELECT grade FROM public.course_final_grades
    WHERE course_id = :'COURSE' AND student_id = :'STU1'),
  format('หน้าจอเห็น %s · ประกาศไว้ %s',
    COALESCE(public.get_student_score_summary(:'COURSE')->>'grade','NULL'),
    COALESCE((SELECT grade FROM public.course_final_grades
               WHERE course_id = :'COURSE' AND student_id = :'STU1'),'NULL')));
RESET ROLE;
