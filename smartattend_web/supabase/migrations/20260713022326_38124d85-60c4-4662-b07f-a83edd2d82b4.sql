
CREATE TABLE public.invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  role app_role NOT NULL DEFAULT 'instructor',
  department TEXT,
  token TEXT NOT NULL UNIQUE,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','revoked')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invitations_email_idx ON public.invitations(email);
CREATE INDEX invitations_status_idx ON public.invitations(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invitations TO authenticated;
GRANT ALL ON public.invitations TO service_role;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view invitations" ON public.invitations FOR SELECT TO authenticated
USING (internal.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can insert invitations" ON public.invitations FOR INSERT TO authenticated
WITH CHECK (internal.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update invitations" ON public.invitations FOR UPDATE TO authenticated
USING (internal.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (internal.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete invitations" ON public.invitations FOR DELETE TO authenticated
USING (internal.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_invitations_updated_at
BEFORE UPDATE ON public.invitations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  target TEXT,
  target_id TEXT,
  detail TEXT,
  before JSONB,
  after JSONB,
  reason TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_at_idx ON public.audit_logs(created_at DESC);
CREATE INDEX audit_logs_actor_idx ON public.audit_logs(actor_id);
CREATE INDEX audit_logs_action_idx ON public.audit_logs(action);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all audit logs" ON public.audit_logs FOR SELECT TO authenticated
USING (internal.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated users can insert own audit log" ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (actor_id = auth.uid() OR actor_id IS NULL);
