CREATE OR REPLACE FUNCTION public.check_in_attendance(
  _session_id uuid,
  _photo_data_url text,
  _confidence numeric
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _started timestamptz;
  _late_after int;
  _status text;
  _sess_status text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT cs.started_at, cs.late_after_minutes, cs.status
    INTO _started, _late_after, _sess_status
  FROM public.class_sessions cs
  WHERE cs.id = _session_id;

  IF _started IS NULL THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;
  IF _sess_status <> 'open' THEN
    RAISE EXCEPTION 'session_closed';
  END IF;

  _status := CASE
    WHEN now() > _started + make_interval(mins => COALESCE(_late_after, 15)) THEN 'late'
    ELSE 'on_time'
  END;

  INSERT INTO public.attendance_records (session_id, student_id, photo_data_url, confidence, checked_in_at, status)
  VALUES (_session_id, _uid, _photo_data_url, _confidence, now(), _status)
  ON CONFLICT (session_id, student_id) DO UPDATE
    SET photo_data_url = EXCLUDED.photo_data_url,
        confidence = EXCLUDED.confidence,
        checked_in_at = COALESCE(public.attendance_records.checked_in_at, EXCLUDED.checked_in_at),
        status = CASE WHEN public.attendance_records.status = 'absent' THEN EXCLUDED.status ELSE public.attendance_records.status END;

  RETURN _status;
END;
$$;

REVOKE ALL ON FUNCTION public.check_in_attendance(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_attendance(uuid, text, numeric) TO authenticated;