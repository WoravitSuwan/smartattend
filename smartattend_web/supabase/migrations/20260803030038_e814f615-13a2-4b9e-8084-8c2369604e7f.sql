ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'on_time'
  CHECK (status IN ('on_time','late','absent'));

ALTER TABLE public.attendance_records ALTER COLUMN photo_data_url DROP NOT NULL;
ALTER TABLE public.attendance_records ALTER COLUMN confidence DROP NOT NULL;
ALTER TABLE public.attendance_records ALTER COLUMN checked_in_at DROP NOT NULL;

DROP POLICY IF EXISTS "Instructors insert absent records" ON public.attendance_records;
CREATE POLICY "Instructors insert absent records" ON public.attendance_records
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.class_sessions cs
      WHERE cs.id = session_id AND cs.instructor_id = auth.uid()
    )
  );