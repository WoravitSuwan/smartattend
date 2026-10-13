-- ═══════════════════════════════════════════════════════════════════════════
--  กลุ่ม E — โครงสร้างคะแนนและงานที่มอบหมาย (UC-12 ถึง UC-14)
-- ═══════════════════════════════════════════════════════════════════════════
\set INS    '11111111-1111-4111-8111-111111111102'
\set STU1   '11111111-1111-4111-8111-111111111201'
\set STU2   '11111111-1111-4111-8111-111111111202'
\set COURSE '22222222-2222-4222-8222-222222222201'
\set COURSE2 '22222222-2222-4222-8222-222222222202'
\set INS2   '11111111-1111-4111-8111-111111111103'
\set CLAB   '44444444-4444-4444-8444-444444440002'
\set LAB1   '55555555-5555-4555-8555-555555550001'

SELECT q.act_as(:'INS');
SET ROLE authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- E-01 / E-02 / E-03 น้ำหนักหมวดต้องรวมได้ 100 พอดี
--   ใช้รายวิชาที่สองซึ่งยังไม่มีโครงสร้าง จะได้ไม่กระทบข้อมูลของรายวิชาแรก
--   รายวิชาที่สองเป็นของอาจารย์อีกคน จึงต้องสวมบทบาทเป็นเจ้าของรายวิชานั้น
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
SELECT q.act_as(:'INS2');
SET ROLE authenticated;
SELECT q.runs('E','E-01','สร้างหมวดคะแนนที่น้ำหนักรวมได้ 100','บันทึกสำเร็จ',
  format($f$SELECT public.save_grade_structure_v2(%L::uuid, %s::jsonb, true, %L)$f$,
    :'COURSE2',
    quote_literal(jsonb_build_array(
      jsonb_build_object('name','TEST_กลางภาค','kind','midterm','weight_percent',40),
      jsonb_build_object('name','TEST_ปลายภาค','kind','final','weight_percent',60,
                         'is_final_exam',true))::text),
    'TEST_ตั้งโครงสร้างครั้งแรก'));

SELECT q.raises('E','E-02a','สร้างหมวดคะแนนที่น้ำหนักรวมได้ 95','ต้องถูกปฏิเสธ',
  format($f$SELECT public.save_grade_structure_v2(%L::uuid, %s::jsonb, true, %L)$f$,
    :'COURSE2',
    quote_literal(jsonb_build_array(
      jsonb_build_object('name','TEST_กลางภาค','kind','midterm','weight_percent',40),
      jsonb_build_object('name','TEST_ปลายภาค','kind','final','weight_percent',55,
                         'is_final_exam',true))::text),
    'TEST_น้ำหนักไม่ครบ'),
  '100');

SELECT q.ok('E','E-02b','ข้อความที่ปฏิเสธต้องบอกว่าขาดกี่เปอร์เซ็นต์',
  'ข้อความมีตัวเลขน้ำหนักที่รวมได้จริง (95)',
  (SELECT got FROM q.results WHERE code = 'E-02a') LIKE '%95%',
  (SELECT got FROM q.results WHERE code = 'E-02a'));

-- ───────────────────────────────────────────────────────────────────────────
-- E-03 แก้น้ำหนักย่อยจาก 60/40 เป็น 50/50 ในครั้งเดียว ต้องผ่าน
--   เป็นการพิสูจน์ว่ากฎ "ผลรวมต้องเป็น 100" ถูกบังคับตอน COMMIT ไม่ใช่ตอนสั่ง
--   ถ้าบังคับทีละแถว การแก้ 60→50 แถวแรกจะทำให้ผลรวมเป็น 90 แล้วพังทันที
-- ───────────────────────────────────────────────────────────────────────────
SELECT q.runs('E','E-03','แก้น้ำหนักหมวดจาก 40/60 เป็น 50/50 ในคำสั่งเดียว','บันทึกสำเร็จ',
  format($f$SELECT public.save_grade_structure_v2(%L::uuid, %s::jsonb, false, %L)$f$,
    :'COURSE2',
    quote_literal((SELECT jsonb_agg(jsonb_build_object(
        'id', gc.id, 'name', gc.name, 'kind', gc.kind, 'weight_percent', 50,
        'is_final_exam', gc.is_final_exam))
      FROM public.grade_components gc WHERE gc.course_id = :'COURSE2')::text),
    'TEST_ปรับน้ำหนักให้เท่ากัน'));

SELECT q.eq('E','E-03b','น้ำหนักรวมหลังแก้ต้องยังเป็น 100','รวม = 100',
  (SELECT sum(weight_percent) FROM public.grade_components WHERE course_id = :'COURSE2'),
  100::numeric);

-- ───────────────────────────────────────────────────────────────────────────
-- E-04 แก้ชื่อและคะแนนเต็มของรายการที่มีคะแนนแล้ว คะแนนของนักศึกษาต้องไม่หาย
-- ───────────────────────────────────────────────────────────────────────────
RESET ROLE;
SELECT q.act_as(:'INS');       -- กลับมาเป็นอาจารย์เจ้าของรายวิชาแรก
SET ROLE authenticated;
SELECT q.runs('E','E-04a','แก้ชื่อและคะแนนเต็มของรายการที่มีคะแนนอยู่แล้ว','บันทึกสำเร็จ',
  format($f$SELECT public.save_grade_item(%L::uuid, %L, 'other', 20, 0, %L::uuid, 'reject', %L)$f$,
    :'COURSE', 'TEST_LAB1 (แก้ชื่อแล้ว)', :'LAB1', 'TEST_ขยายคะแนนเต็มเป็น 20'));

SELECT q.eq('E','E-04b','คะแนนของนักศึกษาต้องยังอยู่ครบหลังแก้หัวข้อ','STU1 ยังได้ 10 เท่าเดิม',
  (SELECT score FROM public.student_grades WHERE grade_item_id = :'LAB1' AND student_id = :'STU1'),
  10::numeric);
SELECT q.eq('E','E-04c','จำนวนแถวคะแนนของหัวข้อนี้ต้องไม่ลดลง','ยังมี 4 แถว',
  (SELECT count(*) FROM public.student_grades WHERE grade_item_id = :'LAB1'), 4::bigint);

-- คืนคะแนนเต็มกลับเป็น 10 เพื่อไม่ให้กระทบยอดรวมที่กลุ่ม F ใช้
SELECT public.save_grade_item(:'COURSE', 'TEST_LAB1', 'other', 10, 0, :'LAB1', 'reject',
                              'TEST_คืนคะแนนเต็มเดิม');

-- ───────────────────────────────────────────────────────────────────────────
-- E-05 ลบรายการคะแนนที่มีคะแนนอยู่ ต้องให้ยืนยันและบันทึกประวัติ
-- ───────────────────────────────────────────────────────────────────────────
SELECT q.raises('E','E-05a','ลบหัวข้อคะแนนที่มีคะแนนอยู่โดยไม่ยืนยันชื่อ','ต้องถูกปฏิเสธ',
  format('SELECT public.delete_grade_item(%L::uuid, %L, NULL)', :'LAB1', 'TEST_ลบโดยไม่ยืนยัน'),
  'ยืนยัน');

SELECT q.eq('E','E-05b','หัวข้อที่ยังไม่ได้ยืนยันต้องยังอยู่','ยังมีหัวข้ออยู่',
  (SELECT count(*) FROM public.grade_items WHERE id = :'LAB1'), 1::bigint);

-- ───────────────────────────────────────────────────────────────────────────
-- E-07 โพสต์งานแล้วเลือกหมวด ต้องสร้างรายการคะแนนให้อัตโนมัติ
-- E-11 โพสต์งานโดยปิดสวิตช์นับคะแนน ต้องไม่สร้างรายการคะแนน
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO public.assignments (id, course_id, title, max_score, created_by, due_at,
                                component_id, counts_toward_grade)
VALUES ('66666666-6666-4666-8666-666666660001', :'COURSE', 'TEST_งานผูกหมวด', 25, :'INS',
        now() + interval '7 days', :'CLAB', true);

SELECT q.ok('E','E-07a','โพสต์งานพร้อมเลือกหมวด ต้องสร้างหัวข้อคะแนนให้เอง',
  'มี grade_item ที่ source = assignment ผูกกับงานนี้',
  EXISTS (SELECT 1 FROM public.assignments a JOIN public.grade_items gi ON gi.id = a.grade_item_id
          WHERE a.id = '66666666-6666-4666-8666-666666660001' AND gi.source = 'assignment'),
  COALESCE((SELECT gi.name || ' เต็ม ' || gi.max_score FROM public.assignments a
             JOIN public.grade_items gi ON gi.id = a.grade_item_id
            WHERE a.id = '66666666-6666-4666-8666-666666660001'), 'ไม่ได้สร้างหัวข้อคะแนน'));

SELECT q.eq('E','E-07b','คะแนนเต็มของหัวข้อที่สร้างให้ ต้องเท่ากับคะแนนเต็มของงาน','เต็ม 25',
  (SELECT gi.max_score FROM public.assignments a JOIN public.grade_items gi ON gi.id = a.grade_item_id
    WHERE a.id = '66666666-6666-4666-8666-666666660001'), 25::numeric);

INSERT INTO public.assignments (id, course_id, title, max_score, created_by, due_at,
                                component_id, counts_toward_grade)
VALUES ('66666666-6666-4666-8666-666666660002', :'COURSE', 'TEST_งานไม่นับคะแนน', 10, :'INS',
        now() + interval '7 days', :'CLAB', false);

SELECT q.ok('E','E-11','โพสต์งานโดยปิดสวิตช์นับคะแนน ต้องไม่สร้างหัวข้อคะแนน',
  'grade_item_id ต้องเป็น NULL',
  (SELECT grade_item_id FROM public.assignments
    WHERE id = '66666666-6666-4666-8666-666666660002') IS NULL,
  COALESCE((SELECT grade_item_id::text FROM public.assignments
             WHERE id = '66666666-6666-4666-8666-666666660002'), 'NULL'));

-- ───────────────────────────────────────────────────────────────────────────
-- E-08 ตรวจงานให้คะแนน คะแนนต้องเข้าตารางรวมโดยไม่ต้องกรอกซ้ำ
-- E-09 แก้คะแนนงานภายหลัง คะแนนรวมต้องขยับตามทันที
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO public.assignment_submissions (id, assignment_id, student_id, submitted_at, status)
VALUES ('77777777-7777-4777-8777-777777770001','66666666-6666-4666-8666-666666660001',
        :'STU1', now() - interval '1 day', 'submitted');

UPDATE public.assignment_submissions
   SET score = 20, graded_by = :'INS', graded_at = now(), status = 'graded'
 WHERE id = '77777777-7777-4777-8777-777777770001';

SELECT q.eq('E','E-08','ให้คะแนนงานแล้ว คะแนนต้องไหลเข้าตารางคะแนนรวมเอง','ได้ 20 ในตารางคะแนน',
  (SELECT sg.score FROM public.assignment_submissions s
     JOIN public.assignments a ON a.id = s.assignment_id
     JOIN public.student_grades sg ON sg.grade_item_id = a.grade_item_id AND sg.student_id = s.student_id
   WHERE s.id = '77777777-7777-4777-8777-777777770001'), 20::numeric);

UPDATE public.assignment_submissions SET score = 15
 WHERE id = '77777777-7777-4777-8777-777777770001';

SELECT q.eq('E','E-09','แก้คะแนนงานภายหลัง คะแนนในตารางรวมต้องขยับตาม','เปลี่ยนเป็น 15',
  (SELECT sg.score FROM public.assignment_submissions s
     JOIN public.assignments a ON a.id = s.assignment_id
     JOIN public.student_grades sg ON sg.grade_item_id = a.grade_item_id AND sg.student_id = s.student_id
   WHERE s.id = '77777777-7777-4777-8777-777777770001'), 15::numeric);

-- ───────────────────────────────────────────────────────────────────────────
-- E-10 ส่งงานช้ากว่ากำหนด ต้องหักคะแนนตามกฎที่ตั้งไว้
--   ตั้งหักวันละ 10% สูงสุด 50% · ส่งช้า 3 วัน · เต็ม 25 ได้ 20
--   หัก 3 × 10% = 30% ของคะแนนเต็ม 25 = 7.5 → เหลือ 12.5
-- ───────────────────────────────────────────────────────────────────────────
UPDATE public.assignments
   SET due_at = now() - interval '3 days', late_penalty_per_day = 10, late_penalty_max = 50
 WHERE id = '66666666-6666-4666-8666-666666660001';

SELECT q.eq('E','E-10a','คำนวณค่าปรับส่งช้า 3 วัน วันละ 10% ของเต็ม 25','หัก 7.5 คะแนน',
  (public.compute_late_penalty(25, now() - interval '3 days', now(), 10, 50)->>'penalty_points')::numeric,
  7.5::numeric);
SELECT q.eq('E','E-10b','จำนวนวันที่ส่งช้าต้องนับได้ถูก','3 วัน',
  (public.compute_late_penalty(25, now() - interval '3 days', now(), 10, 50)->>'late_days')::int, 3);
SELECT q.eq('E','E-10c','ค่าปรับต้องไม่เกินเพดานที่ตั้งไว้ (ส่งช้า 30 วัน เพดาน 50%)','หักไม่เกิน 12.5',
  (public.compute_late_penalty(25, now() - interval '30 days', now(), 10, 50)->>'penalty_points')::numeric,
  12.5::numeric);

RESET ROLE;
