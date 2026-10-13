-- แก้วิธีคิดเปอร์เซ็นต์การเข้าเรียนให้ตรงกับความเป็นจริง
--
-- ของเดิม:
--   % = (ตรงเวลา + สาย) ÷ จำนวน "แถวบันทึก" ของนักศึกษาคนนั้น
-- ปัญหา 2 ข้อ
--   1. ตัวหารนับเฉพาะคาบที่มีแถวบันทึกอยู่แล้ว แถว "ขาดเรียน" จะถูกสร้าง
--      ตอนอาจารย์กดปิดคลาสเท่านั้น คาบที่เปิดค้างไว้หรือยังไม่ปิดจึงหายไป
--      จากตัวหาร ทำให้เปอร์เซ็นต์ขยับไปมาโดยไม่มีเหตุผลที่อธิบายได้
--   2. "ลา" (excused) ถูกนับในตัวหารแต่ไม่นับในตัวตั้ง นักศึกษาที่ลาถูกต้อง
--      ตามระเบียบจึงโดนหักเปอร์เซ็นต์เหมือนขาดเรียน
--
-- ของใหม่: ยึด "คาบที่ปิดแล้ว" ของรายวิชาเป็นฐาน และกันคาบที่ลาออกจากฐาน
--   % = (ตรงเวลา + สาย) ÷ (คาบที่ปิดแล้วทั้งหมด − คาบที่ลา)
-- คาบที่ยังเปิดอยู่ไม่ถูกนับ เพราะยังสรุปไม่ได้ว่ามาหรือไม่มา

-- ───────────────────────────────────────────────────────────────────────────
-- DEF-007 — ต้อง DROP ก่อน ไม่งั้น migration ชุดนี้เล่นซ้ำจากฐานข้อมูลว่างไม่ได้
--
-- CREATE OR REPLACE VIEW เปลี่ยน "ชนิดของคอลัมน์" ที่มีอยู่แล้วไม่ได้
-- วิวนี้ถูกนิยามใหม่สามครั้งโดยชนิดสลับไปมา bigint → integer → bigint
-- (20260806094800 → 20260927100000 → 20260929021502) การเล่นซ้ำจึงล้ม
-- ด้วย "cannot change data type of view column"
--
-- การเพิ่ม DROP ตรงนี้ไม่กระทบฐานข้อมูลที่ใช้งานอยู่ เพราะ migration ไฟล์นี้
-- ถูกบันทึกว่า apply ไปแล้ว Supabase จะไม่รันซ้ำ และนิยามวิวที่ได้ท้ายสุด
-- เหมือนเดิมทุกประการ เปลี่ยนแค่ให้สร้างใหม่จากศูนย์ได้
-- ไม่ใช้ CASCADE เพราะตรวจแล้วไม่มีอ็อบเจกต์ในฐานข้อมูลใดพึ่งพาวิวนี้
-- (มีเพียงโค้ดฝั่งหน้าจอที่ SELECT จากมัน ซึ่งไม่ใช่การพึ่งพาระดับสคีมา)
-- ───────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.v_attendance_summary;

CREATE OR REPLACE VIEW public.v_attendance_summary
WITH (security_invoker = true) AS
WITH closed AS (
  SELECT cs.course_id, count(*)::int AS closed_sessions
  FROM public.class_sessions cs
  WHERE cs.status = 'closed'
  GROUP BY cs.course_id
)
SELECT
  ce.student_id,
  ce.course_id,
  c.code AS course_code,
  c.name AS course_name,
  count(ar.id) FILTER (WHERE ar.status = 'on_time')::int AS on_time_count,
  count(ar.id) FILTER (WHERE ar.status = 'late')::int    AS late_count,
  count(ar.id) FILTER (WHERE ar.status = 'absent')::int  AS absent_count,
  COALESCE(cl.closed_sessions, 0)                        AS total_sessions,
  CASE
    WHEN COALESCE(cl.closed_sessions, 0)
         - count(ar.id) FILTER (WHERE ar.status = 'excused') > 0
    THEN ROUND(
      100.0 * count(ar.id) FILTER (WHERE ar.status IN ('on_time', 'late'))
      / (COALESCE(cl.closed_sessions, 0)
         - count(ar.id) FILTER (WHERE ar.status = 'excused')), 1)
    ELSE NULL
  END AS attendance_rate
FROM public.course_enrollments ce
JOIN public.courses c ON c.id = ce.course_id
LEFT JOIN closed cl ON cl.course_id = ce.course_id
LEFT JOIN public.class_sessions cs
  ON cs.course_id = ce.course_id AND cs.status = 'closed'
LEFT JOIN public.attendance_records ar
  ON ar.session_id = cs.id AND ar.student_id = ce.student_id
WHERE ce.status = 'confirmed' AND ce.student_id IS NOT NULL
GROUP BY ce.student_id, ce.course_id, c.code, c.name, cl.closed_sessions;

GRANT SELECT ON public.v_attendance_summary TO authenticated;
