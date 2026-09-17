DROP TABLE IF EXISTS public.invitations CASCADE;

CREATE TABLE public.role_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_role TEXT NOT NULL CHECK (requested_role = 'instructor'),
  department TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

GRANT SELECT, INSERT ON public.role_requests TO authenticated;
GRANT ALL ON public.role_requests TO service_role;

ALTER TABLE public.role_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users create own role request" ON public.role_requests
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users view own role request" ON public.role_requests
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Admins manage all role requests" ON public.role_requests
  FOR ALL TO authenticated
  USING (internal.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (internal.has_role(auth.uid(), 'admin'::public.app_role));

ALTER PUBLICATION supabase_realtime ADD TABLE public.role_requests;
ALTER TABLE public.role_requests REPLICA IDENTITY FULL;