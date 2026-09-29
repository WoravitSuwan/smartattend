CREATE OR REPLACE VIEW public.v_attendance_summary
WITH (security_invoker = true) AS
WITH closed AS (
  SELECT cs.course_id, count(*) AS closed_sessions
  FROM public.class_sessions cs
  WHERE cs.status = 'closed'
  GROUP BY cs.course_id
)
SELECT
  ce.student_id,
  ce.course_id,
  c.code AS course_code,
  c.name AS course_name,
  count(ar.id) FILTER (WHERE ar.status = 'on_time') AS on_time_count,
  count(ar.id) FILTER (WHERE ar.status = 'late') AS late_count,
  count(ar.id) FILTER (WHERE ar.status = 'absent') AS absent_count,
  COALESCE(cl.closed_sessions, 0) AS total_sessions,
  CASE
    WHEN COALESCE(cl.closed_sessions, 0)
         - count(ar.id) FILTER (WHERE ar.status = 'excused') > 0
    THEN ROUND(
      100.0 * count(ar.id) FILTER (WHERE ar.status IN ('on_time', 'late'))
      / (
        COALESCE(cl.closed_sessions, 0)
        - count(ar.id) FILTER (WHERE ar.status = 'excused')
      ),
      1
    )
    ELSE NULL
  END AS attendance_rate
FROM public.course_enrollments ce
JOIN public.courses c ON c.id = ce.course_id
LEFT JOIN closed cl ON cl.course_id = ce.course_id
LEFT JOIN public.class_sessions cs
  ON cs.course_id = ce.course_id
  AND cs.status = 'closed'
LEFT JOIN public.attendance_records ar
  ON ar.session_id = cs.id
  AND ar.student_id = ce.student_id
WHERE ce.status = 'confirmed'
  AND ce.student_id IS NOT NULL
GROUP BY
  ce.student_id,
  ce.course_id,
  c.code,
  c.name,
  cl.closed_sessions;

GRANT SELECT ON public.v_attendance_summary TO authenticated;
