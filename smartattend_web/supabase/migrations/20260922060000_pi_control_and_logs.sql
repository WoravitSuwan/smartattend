-- Lets an instructor pause/resume the Pi's face-scanning for their own open
-- class session, and view the Pi's recent operation log from the web app
-- instead of needing SSH access to the device.

-- 1. Pause flag on the session the Pi already polls for. The Pi re-checks
--    this on every poll cycle (~4s); it does not close the session, so
--    already-recorded check-ins and the late/on-time cutoff are unaffected.
ALTER TABLE public.class_sessions
  ADD COLUMN scanning_paused boolean NOT NULL DEFAULT false;

-- 2. Rolling operation log the Pi posts to with the service_role key
--    (bypasses RLS, same pattern as device_heartbeats). Only meaningful
--    events are pushed from the Pi side (session found/closed, check-ins,
--    errors, periodic performance summaries) — not per-frame noise.
CREATE TABLE public.device_logs (
  id bigserial PRIMARY KEY,
  device_code text NOT NULL,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_logs_created_at_idx ON public.device_logs (created_at DESC);

ALTER TABLE public.device_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and instructors can view device logs"
ON public.device_logs FOR SELECT TO authenticated
USING (
  internal.has_role(auth.uid(), 'admin'::app_role)
  OR internal.has_role(auth.uid(), 'instructor'::app_role)
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.device_logs;

-- 3. Instructors also need to see whether the classroom Pi is online at all
--    (previously admin-only) so they know a "no logs coming in" gap means
--    the device is offline, not just quiet.
DROP POLICY IF EXISTS "Admins can view device heartbeats" ON public.device_heartbeats;
CREATE POLICY "Admins and instructors can view device heartbeats"
ON public.device_heartbeats FOR SELECT TO authenticated
USING (
  internal.has_role(auth.uid(), 'admin'::app_role)
  OR internal.has_role(auth.uid(), 'instructor'::app_role)
);
