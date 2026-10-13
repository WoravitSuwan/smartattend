-- ═══════════════════════════════════════════════════════════════════════════
--  ลบข้อมูลทดสอบทั้งหมด — ใช้กับฐานข้อมูลจริงได้
--
--  ลบจากปลายทางย้อนขึ้นต้นทาง เพื่อไม่ชน foreign key
--  เงื่อนไขการลบยึดจาก "ผู้ใช้ที่อีเมลลงท้าย @rmutl.ac.th และขึ้นต้นด้วย test."
--  กับ "รายวิชาที่รหัสขึ้นต้นด้วย TEST_" เท่านั้น แถวอื่นไม่ถูกแตะ
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

CREATE TEMP TABLE IF NOT EXISTS _test_users ON COMMIT PRESERVE ROWS AS
SELECT user_id FROM public.profiles WHERE name LIKE 'TEST\_%';
TRUNCATE _test_users;
INSERT INTO _test_users SELECT user_id FROM public.profiles WHERE name LIKE 'TEST\_%';

CREATE TEMP TABLE IF NOT EXISTS _test_courses ON COMMIT PRESERVE ROWS AS
SELECT id FROM public.courses WHERE code LIKE 'TEST\_%';
TRUNCATE _test_courses;
INSERT INTO _test_courses SELECT id FROM public.courses WHERE code LIKE 'TEST\_%';

-- ปลดสถานะ "ประกาศผลแล้ว" ก่อน เพราะ trigger check_published_course_weight
-- บังคับว่ารายวิชาที่ประกาศผลแล้วต้องมีน้ำหนักรวม 100 เสมอ ทำให้ลบหมวดไม่ได้
UPDATE public.courses SET final_grade_published = false, grades_locked = false
 WHERE id IN (SELECT id FROM _test_courses);

DELETE FROM public.student_grades
 WHERE grade_item_id IN (SELECT id FROM public.grade_items WHERE course_id IN (SELECT id FROM _test_courses))
    OR student_id IN (SELECT user_id FROM _test_users);
DELETE FROM public.assignment_submissions
 WHERE assignment_id IN (SELECT id FROM public.assignments WHERE course_id IN (SELECT id FROM _test_courses))
    OR student_id IN (SELECT user_id FROM _test_users);
DELETE FROM public.assignments        WHERE course_id IN (SELECT id FROM _test_courses);
DELETE FROM public.grade_items        WHERE course_id IN (SELECT id FROM _test_courses);
DELETE FROM public.grade_components   WHERE course_id IN (SELECT id FROM _test_courses);
DELETE FROM public.grade_scales       WHERE course_id IN (SELECT id FROM _test_courses);
DELETE FROM public.course_final_grades WHERE course_id IN (SELECT id FROM _test_courses)
                                          OR student_id IN (SELECT user_id FROM _test_users);
DELETE FROM public.attendance_records
 WHERE session_id IN (SELECT id FROM public.class_sessions WHERE course_id IN (SELECT id FROM _test_courses))
    OR student_id IN (SELECT user_id FROM _test_users);
DELETE FROM public.leave_requests     WHERE course_id IN (SELECT id FROM _test_courses)
                                         OR student_id IN (SELECT user_id FROM _test_users);
DELETE FROM public.class_sessions     WHERE course_id IN (SELECT id FROM _test_courses);
DELETE FROM public.course_schedules   WHERE course_id IN (SELECT id FROM _test_courses);
DELETE FROM public.course_enrollments WHERE course_id IN (SELECT id FROM _test_courses)
                                         OR student_id IN (SELECT user_id FROM _test_users);
-- student_courses เก็บรายวิชาที่นักศึกษาคีย์เอง อ้างด้วย user_id + code
DELETE FROM public.student_courses    WHERE user_id IN (SELECT user_id FROM _test_users)
                                         OR code LIKE 'TEST\_%';
DELETE FROM public.courses            WHERE id IN (SELECT id FROM _test_courses);

DELETE FROM public.notifications          WHERE user_id IN (SELECT user_id FROM _test_users);
DELETE FROM public.registration_statuses  WHERE user_id IN (SELECT user_id FROM _test_users);
DELETE FROM public.role_requests          WHERE user_id IN (SELECT user_id FROM _test_users);
DELETE FROM public.face_images            WHERE user_id IN (SELECT user_id FROM _test_users)
                                             OR student_id IN (SELECT user_id FROM _test_users);
DELETE FROM public.audit_logs             WHERE actor_id IN (SELECT user_id FROM _test_users);
DELETE FROM public.grade_audit_logs       WHERE modified_by IN (SELECT user_id FROM _test_users);
DELETE FROM public.ai_usage_logs          WHERE user_id IN (SELECT user_id FROM _test_users);
DELETE FROM public.user_roles             WHERE user_id IN (SELECT user_id FROM _test_users);
DELETE FROM public.profiles               WHERE user_id IN (SELECT user_id FROM _test_users);
DELETE FROM auth.users                    WHERE id IN (SELECT user_id FROM _test_users);

DROP TABLE IF EXISTS _test_users;
DROP TABLE IF EXISTS _test_courses;
