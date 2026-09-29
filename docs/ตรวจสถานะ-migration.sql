-- ═══════════════════════════════════════════════════════════════════════════
--  ตรวจว่าฐานข้อมูลบนคลาวด์รับ migration ล่าสุดไปแล้วหรือยัง
--
--  วิธีใช้  เปิด Supabase Dashboard > SQL Editor > วางทั้งไฟล์นี้ > Run
--           ทุกแถวต้องขึ้น OK ถ้ามีแถวไหนขึ้น MISSING แปลว่ายังไม่ได้รัน
--           `supabase db push` หรือรันไปไม่ครบ
--
--  ไฟล์นี้อ่านอย่างเดียว ไม่แก้ข้อมูลใด ๆ
-- ═══════════════════════════════════════════════════════════════════════════

WITH checks(ลำดับ, migration, สิ่งที่ตรวจ, มีแล้ว) AS (
  VALUES
    (1, '20260927110000 grade_item_rpc',
        'ฟังก์ชัน grade_item_score_count',
        to_regprocedure('public.grade_item_score_count(uuid)') IS NOT NULL),

    (2, '20260927130000 record_attendance_server_time',
        'ฟังก์ชัน record_attendance รับ 4 พารามิเตอร์',
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'record_attendance')),

    (3, '20260927150000 grade_scale_single_source',
        'ตาราง grade_scales',
        to_regclass('public.grade_scales') IS NOT NULL),

    (4, '20260927180000 save_grades_atomic',
        'ฟังก์ชัน save_student_grades',
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'save_student_grades')),

    (5, '20260927190000 grade_structure_three_levels',
        'คอลัมน์ grade_components.calc_mode',
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'grade_components'
                  AND column_name = 'calc_mode')),

    (6, '20260927190000 grade_structure_three_levels',
        'คอลัมน์ grade_items.weight_in_component',
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'grade_items'
                  AND column_name = 'weight_in_component')),

    (7, '20260927190000 grade_structure_three_levels',
        'ฟังก์ชัน save_grade_structure_v2',
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'save_grade_structure_v2')),

    (8, '20260927200000 score_summary_respects_rls',
        'get_student_score_summary เป็น SECURITY INVOKER',
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'get_student_score_summary'
                  AND NOT p.prosecdef)),

    (9, '20260927210000 fix_masking_rls_blind_spot',
        'ฟังก์ชัน grade_item_is_masked',
        to_regprocedure('public.grade_item_is_masked(uuid)') IS NOT NULL),

   (10, '20260927220000 assignment_grade_link',
        'คอลัมน์ assignments.component_id',
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'assignments'
                  AND column_name = 'component_id')),

   (11, '20260927230000 attendance_score',
        'ฟังก์ชัน recalc_attendance_scores',
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'recalc_attendance_scores')),

   (12, '20260927230000 cancelled_sessions',
        'ฟังก์ชัน cancel_class_session',
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'cancel_class_session')),

   (13, '20260927240000 publish_workflow_and_lock',
        'คอลัมน์ courses.grades_locked',
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'courses'
                  AND column_name = 'grades_locked')),

   (14, '20260927240000 publish_workflow_and_lock',
        'ฟังก์ชัน publish_readiness',
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'publish_readiness')),

   (15, '20260928100000 component_items_rpc',
        'ฟังก์ชัน save_component_items',
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'save_component_items')),

    -- ถ้าแถวนี้ขึ้น MISSING แปลว่าปุ่มบันทึกทุกปุ่มยังพังอยู่ด้วย
    --   function public.has_role(uuid, app_role) does not exist
   (16, '20260929100000 fix_log_audit_event_has_role',
        'log_audit_event เรียก internal.has_role ไม่ใช่ public.has_role (ตัวล่าสุด)',
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'log_audit_event'
                  AND p.prosrc LIKE '%internal.has_role(%'))
)
SELECT ลำดับ,
       migration,
       สิ่งที่ตรวจ,
       CASE WHEN มีแล้ว THEN 'OK' ELSE 'MISSING' END AS ผล
FROM checks
ORDER BY ลำดับ;

-- ── สรุปบรรทัดเดียว ────────────────────────────────────────────────────────
-- แถวที่ 16 สำคัญที่สุด ถ้าขึ้น MISSING แปลว่าปุ่ม "บันทึก" ทุกปุ่มในระบบยังพังอยู่
-- ด้วยข้อความ function public.has_role(uuid, app_role) does not exist
-- เพราะ log_audit_event ซึ่งถูกเรียกจาก RPC ที่เขียนข้อมูลทุกตัว ยังชี้ไปที่ฟังก์ชัน
-- ที่ถูกลบไปแล้ว
--
-- แถวที่ 15 ขึ้น MISSING แปลว่าตัวแก้รายการคะแนนในหน้าโครงสร้างคะแนนจะขึ้น
-- error ว่าไม่พบฟังก์ชัน
--
-- ทั้งสองกรณีแก้ด้วยการรัน `supabase db push` ในโฟลเดอร์ smartattend_web
