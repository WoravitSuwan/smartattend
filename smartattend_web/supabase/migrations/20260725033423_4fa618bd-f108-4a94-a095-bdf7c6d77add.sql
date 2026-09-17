REVOKE EXECUTE ON FUNCTION public.log_audit_event(text, text, text, text, jsonb, jsonb, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_course_instructor(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_enrolled_student(uuid, uuid) FROM PUBLIC, anon;