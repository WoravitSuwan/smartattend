-- ═══════════════════════════════════════════════════════════════════════════
--  save_component_items() — บันทึกรายการคะแนนทั้งหมวดในครั้งเดียว
--  ฟังก์ชันที่ทดสอบโหลดมาจาก migration 20260928100000_component_items_rpc.sql
-- ═══════════════════════════════════════════════════════════════════════════

\set SUITE 'save_component_items'

-- ── ข้อมูลตั้งต้น ────────────────────────────────────────────────────────────
TRUNCATE public.courses CASCADE;
TRUNCATE public.audit_logs, public.grade_audit_logs;

INSERT INTO auth.users(id) VALUES
  ('11111111-1111-1111-1111-111111111111'),   -- อาจารย์เจ้าของวิชา
  ('22222222-2222-2222-2222-222222222222'),   -- คนนอก / นักศึกษา ก
  ('33333333-3333-3333-3333-333333333333')    -- นักศึกษา ข
ON CONFLICT DO NOTHING;

INSERT INTO public.courses(id, code, name, instructor_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'CS101', 'วิชาทดสอบ',
   '11111111-1111-1111-1111-111111111111');

INSERT INTO public.grade_components(id, course_id, name, kind, weight_percent, calc_mode) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'LABs', 'lab', 30, 'proportional'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'โครงงาน', 'other', 20, 'weighted_items'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'ปลายภาค', 'final', 30, 'proportional');

-- ── 1. สิทธิ์ ────────────────────────────────────────────────────────────────
SELECT t.act_as('22222222-2222-2222-2222-222222222222');
SELECT t.raises(:'SUITE', 'คนที่ไม่ใช่ผู้สอนแก้รายการคะแนนไม่ได้',
  $q$ SELECT public.save_component_items('bbbbbbbb-0000-0000-0000-000000000001',
        '[{"name":"LAB1","max_score":10}]'::jsonb) $q$,
  'ไม่มีสิทธิ์');

SELECT t.act_as('11111111-1111-1111-1111-111111111111');

-- ── 2. สร้างรายการใหม่ ──────────────────────────────────────────────────────
SELECT t.runs(:'SUITE', 'ผู้สอนสร้างสองรายการในหมวดได้',
  $q$ SELECT public.save_component_items('bbbbbbbb-0000-0000-0000-000000000001',
        '[{"name":"LAB1","max_score":10},{"name":"LAB2","max_score":20}]'::jsonb) $q$);

SELECT t.eq(:'SUITE', 'รายการใหม่ถูกผูกเข้าหมวดครบ',
  (SELECT count(*)::int FROM public.grade_items
    WHERE component_id = 'bbbbbbbb-0000-0000-0000-000000000001'), 2);

SELECT t.eq(:'SUITE', 'ไม่เขียนคอลัมน์ weight ที่เลิกใช้แล้ว',
  (SELECT COALESCE(sum(weight), -1) FROM public.grade_items
    WHERE component_id = 'bbbbbbbb-0000-0000-0000-000000000001'), 0::numeric);

SELECT t.eq(:'SUITE', 'position เรียงตามลำดับในอาเรย์',
  (SELECT string_agg(name, ',' ORDER BY position) FROM public.grade_items
    WHERE component_id = 'bbbbbbbb-0000-0000-0000-000000000001'), 'LAB1,LAB2');

SELECT t.eq(:'SUITE', 'category เดามาจาก kind ของหมวด (lab -> assignment)',
  (SELECT DISTINCT category FROM public.grade_items
    WHERE component_id = 'bbbbbbbb-0000-0000-0000-000000000001'), 'assignment');

SELECT t.runs(:'SUITE', 'หมวด kind=final สร้างรายการได้',
  $q$ SELECT public.save_component_items('bbbbbbbb-0000-0000-0000-000000000003',
        '[{"name":"ข้อสอบปลายภาค","max_score":100}]'::jsonb) $q$);

SELECT t.eq(:'SUITE', 'หมวด final ได้ category = final (มีผลกับ RLS ที่ปิดบังคะแนน)',
  (SELECT category FROM public.grade_items WHERE name = 'ข้อสอบปลายภาค'), 'final');

-- ── 3. ชื่อซ้ำ และคะแนนเต็มศูนย์ ─────────────────────────────────────────────
SELECT t.raises(:'SUITE', 'ชื่อรายการซ้ำกันในหมวดเดียวกันถูกปฏิเสธ',
  $q$ SELECT public.save_component_items('bbbbbbbb-0000-0000-0000-000000000001',
        '[{"name":"ซ้ำ","max_score":10},{"name":"ซ้ำ","max_score":10}]'::jsonb) $q$,
  'ซ้ำกันในหมวดเดียวกัน');

SELECT t.raises(:'SUITE', 'คะแนนเต็มเป็นศูนย์ถูกปฏิเสธ',
  $q$ SELECT public.save_component_items('bbbbbbbb-0000-0000-0000-000000000001',
        '[{"name":"ศูนย์","max_score":0}]'::jsonb) $q$,
  'ต้องมากกว่า 0');

SELECT t.raises(:'SUITE', 'คะแนนเต็มติดลบถูกปฏิเสธ',
  $q$ SELECT public.save_component_items('bbbbbbbb-0000-0000-0000-000000000001',
        '[{"name":"ติดลบ","max_score":-5}]'::jsonb) $q$,
  'ต้องมากกว่า 0');

SELECT t.raises(:'SUITE', 'รายการที่ไม่ใส่ชื่อถูกปฏิเสธ',
  $q$ SELECT public.save_component_items('bbbbbbbb-0000-0000-0000-000000000001',
        '[{"name":"  ","max_score":10}]'::jsonb) $q$,
  'ยังไม่ได้ใส่ชื่อ');

-- ── 4. น้ำหนักย่อยที่รวมไม่ถึง 100 ต้องถูกปฏิเสธตอน COMMIT ──────────────────
SELECT t.raises(:'SUITE', 'น้ำหนักย่อยรวม 90 ถูกปฏิเสธ (CONSTRAINT TRIGGER ตอน COMMIT)',
  $q$ SELECT public.save_component_items('bbbbbbbb-0000-0000-0000-000000000002',
        '[{"name":"รายงาน","max_score":50,"weight_in_component":50},
          {"name":"นำเสนอ","max_score":50,"weight_in_component":40}]'::jsonb) $q$,
  'รวมเท่ากับ 100 พอดี');

SELECT t.eq(:'SUITE', 'รายการที่ถูกปฏิเสธต้องไม่ค้างอยู่ในฐานข้อมูล',
  (SELECT count(*)::int FROM public.grade_items
    WHERE component_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 0);

SELECT t.runs(:'SUITE', 'น้ำหนักย่อยรวม 100 พอดีผ่าน',
  $q$ SELECT public.save_component_items('bbbbbbbb-0000-0000-0000-000000000002',
        '[{"name":"รายงาน","max_score":50,"weight_in_component":60},
          {"name":"นำเสนอ","max_score":50,"weight_in_component":40}]'::jsonb) $q$);

-- ── 5. แก้ 60/40 เป็น 50/50 ในครั้งเดียวต้องผ่าน ─────────────────────────────
--    นี่คือเหตุผลที่ RPC รับทั้งหมวด ถ้าบันทึกทีละรายการ รายการแรกจะทำให้
--    ผลรวมเป็น 90 แล้วพังกลางทางเสมอ
SELECT t.runs(:'SUITE', 'แก้น้ำหนักย่อย 60/40 เป็น 50/50 ในครั้งเดียว',
  $q$ SELECT public.save_component_items('bbbbbbbb-0000-0000-0000-000000000002',
        (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name,
                  'max_score', max_score, 'weight_in_component', 50) ORDER BY position)
           FROM public.grade_items
          WHERE component_id = 'bbbbbbbb-0000-0000-0000-000000000002')) $q$);

SELECT t.eq(:'SUITE', 'น้ำหนักย่อยหลังแก้เป็น 50/50',
  (SELECT string_agg(weight_in_component::text, '/' ORDER BY position)
     FROM public.grade_items
    WHERE component_id = 'bbbbbbbb-0000-0000-0000-000000000002'), '50/50');

-- ── 6. ลดคะแนนเต็มแล้วมีคะแนนเกิน ────────────────────────────────────────────
INSERT INTO public.student_grades(grade_item_id, student_id, score)
SELECT id, '22222222-2222-2222-2222-222222222222', 18
  FROM public.grade_items WHERE name = 'LAB2';
INSERT INTO public.student_grades(grade_item_id, student_id, score)
SELECT id, '33333333-3333-3333-3333-333333333333', 10
  FROM public.grade_items WHERE name = 'LAB2';

CREATE OR REPLACE FUNCTION pg_temp.lab_payload(_new_max numeric)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name,
           'max_score', CASE WHEN name = 'LAB2' THEN _new_max ELSE max_score END)
         ORDER BY position)
    FROM public.grade_items WHERE component_id = 'bbbbbbbb-0000-0000-0000-000000000001'
$$;

SELECT t.raises(:'SUITE', 'ค่าเริ่มต้นคือปฏิเสธ ไม่ตัดสินใจแทนอาจารย์',
  $q$ SELECT public.save_component_items('bbbbbbbb-0000-0000-0000-000000000001',
        pg_temp.lab_payload(12)) $q$,
  'เกินคะแนนเต็มใหม่');

SELECT t.eq(:'SUITE', 'คะแนนเต็มเดิมไม่ถูกแก้เมื่อถูกปฏิเสธ',
  (SELECT max_score FROM public.grade_items WHERE name = 'LAB2'), 20::numeric);

SELECT t.runs(:'SUITE', 'วิธี rescale ปรับตามอัตราส่วน',
  $q$ SELECT public.save_component_items('bbbbbbbb-0000-0000-0000-000000000001',
        pg_temp.lab_payload(12), false, 'rescale', 'ลดคะแนนเต็มตามข้อสอบจริง') $q$);

SELECT t.eq(:'SUITE', 'rescale ปรับทุกคน ไม่ใช่เฉพาะคนที่เกิน (18->10.80, 10->6.00)',
  (SELECT string_agg(sg.score::text, ',' ORDER BY sg.score)
     FROM public.student_grades sg JOIN public.grade_items gi ON gi.id = sg.grade_item_id
    WHERE gi.name = 'LAB2'), '6.00,10.80');

SELECT t.eq(:'SUITE', 'ทุกแถวที่ถูกปรับลง grade_audit_logs พร้อมค่าเดิมและค่าใหม่',
  (SELECT count(*)::int FROM public.grade_audit_logs
    WHERE previous_score IS NOT NULL AND new_score IS NOT NULL), 2);

SELECT t.runs(:'SUITE', 'วิธี clamp ตัดเฉพาะคนที่เกิน',
  $q$ SELECT public.save_component_items('bbbbbbbb-0000-0000-0000-000000000001',
        pg_temp.lab_payload(8), false, 'clamp', 'ตัดลง') $q$);

SELECT t.eq(:'SUITE', 'clamp ไม่แตะคนที่ยังไม่เกิน (6.00 คงเดิม 10.80 -> 8)',
  (SELECT string_agg(sg.score::text, ',' ORDER BY sg.score)
     FROM public.student_grades sg JOIN public.grade_items gi ON gi.id = sg.grade_item_id
    WHERE gi.name = 'LAB2'), '6.00,8');

-- ── 7. กันรายการที่มีคะแนนไม่ให้ถูกลบ ────────────────────────────────────────
SELECT t.runs(:'SUITE', 'ส่งรายการว่างพร้อม delete_missing',
  $q$ SELECT public.save_component_items('bbbbbbbb-0000-0000-0000-000000000001',
        '[]'::jsonb, true, 'reject', 'ล้างรายการที่ไม่ใช้') $q$);

SELECT t.eq(:'SUITE', 'LAB2 ที่มีคะแนนอยู่ต้องไม่ถูกลบ',
  (SELECT string_agg(name, ',') FROM public.grade_items
    WHERE component_id = 'bbbbbbbb-0000-0000-0000-000000000001'), 'LAB2');

SELECT t.eq(:'SUITE', 'คะแนนของนักศึกษาใน LAB2 ยังอยู่ครบ',
  (SELECT count(*)::int FROM public.student_grades sg
     JOIN public.grade_items gi ON gi.id = sg.grade_item_id WHERE gi.name = 'LAB2'), 2);

SELECT t.eq(:'SUITE', 'ชื่อรายการที่ลบไม่ได้ถูกคืนมาใน blocked ให้หน้าจอบอกผู้ใช้',
  (SELECT public.save_component_items('bbbbbbbb-0000-0000-0000-000000000001',
     '[]'::jsonb, true) -> 'blocked' ->> 0), 'LAB2');

-- ── 8. รายการที่คะแนนมาจากที่อื่น ────────────────────────────────────────────
INSERT INTO public.grade_items(course_id, component_id, name, category, max_score, source, position)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
        'งานที่ 1 (จากการตรวจงาน)', 'assignment', 25, 'assignment', 9);

SELECT t.runs(:'SUITE', 'แก้รายการที่ source ไม่ใช่ manual ได้โดยไม่ error',
  $q$ SELECT public.save_component_items('bbbbbbbb-0000-0000-0000-000000000001',
        (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', 'ชื่อที่พยายามเปลี่ยน',
                  'max_score', 999, 'weight_in_component', 0))
           FROM public.grade_items WHERE source = 'assignment')) $q$);

SELECT t.eq(:'SUITE', 'ชื่อและคะแนนเต็มของรายการที่มาจากงานไม่ถูกเขียนทับ',
  (SELECT name || '/' || max_score::text FROM public.grade_items WHERE source = 'assignment'),
  'งานที่ 1 (จากการตรวจงาน)/25');

-- ── 9. คะแนนถูกล็อกหลังประกาศผล ──────────────────────────────────────────────
UPDATE public.courses SET grades_locked = true
 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

SELECT t.raises(:'SUITE', 'คะแนนที่ถูกล็อกแก้โครงสร้างไม่ได้',
  $q$ SELECT public.save_component_items('bbbbbbbb-0000-0000-0000-000000000001',
        '[{"name":"หลังล็อก","max_score":10}]'::jsonb) $q$,
  'ถูกล็อก');

UPDATE public.courses SET grades_locked = false
 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- ── 10. หมวดที่ไม่มีอยู่ ─────────────────────────────────────────────────────
SELECT t.raises(:'SUITE', 'หมวดที่ไม่มีอยู่ถูกปฏิเสธ',
  $q$ SELECT public.save_component_items('cccccccc-0000-0000-0000-000000000009',
        '[{"name":"x","max_score":10}]'::jsonb) $q$,
  'ไม่พบหมวดคะแนนนี้');

-- ── 11. ร่องรอยในประวัติ ─────────────────────────────────────────────────────
SELECT t.ok(:'SUITE', 'ทุกการแก้โครงสร้างลงประวัติ audit_logs',
  (SELECT count(*) FROM public.audit_logs WHERE action = 'grade_component.items') >= 6,
  (SELECT count(*)::text || ' แถว' FROM public.audit_logs
    WHERE action = 'grade_component.items'));
