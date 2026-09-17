ALTER TABLE public.class_sessions
  ADD COLUMN IF NOT EXISTS late_after_minutes INT NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS planned_end_time TIMESTAMPTZ;