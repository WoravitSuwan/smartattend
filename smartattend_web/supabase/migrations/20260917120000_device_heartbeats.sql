-- The Raspberry Pi agent (pi_agent.py) posts a heartbeat roughly every 4
-- seconds while it's running, using the service_role key. This table lets
-- the admin dashboard show whether a classroom Pi is actually online instead
-- of a hardcoded placeholder.
--
-- One row per device_code — the Pi upserts (Prefer: resolution=merge-duplicates)
-- on every heartbeat rather than inserting a new row each time.
CREATE TABLE public.device_heartbeats (
  device_code text PRIMARY KEY,
  room text,
  seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.device_heartbeats ENABLE ROW LEVEL SECURITY;

-- The Pi authenticates with the service_role key, which bypasses RLS
-- entirely, so no write policy is needed for it here. Only admins can
-- read device presence from the web app.
CREATE POLICY "Admins can view device heartbeats"
ON public.device_heartbeats FOR SELECT TO authenticated
USING (internal.has_role(auth.uid(), 'admin'::app_role));

ALTER PUBLICATION supabase_realtime ADD TABLE public.device_heartbeats;
