CREATE TABLE public.registration_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  student_code text,
  student_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending_registration',
  failure_reason text,
  trained_run_id text,
  trained_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT registration_statuses_status_check
    CHECK (status IN ('pending_registration','pending_training','training_failed','training_success'))
);

GRANT SELECT, INSERT, UPDATE ON public.registration_statuses TO authenticated;
GRANT ALL ON public.registration_statuses TO service_role;

ALTER TABLE public.registration_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users and admins can view statuses"
ON public.registration_statuses FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can create own pending status"
ON public.registration_statuses FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND status IN ('pending_registration','pending_training'));

CREATE POLICY "Users can update own status to pending"
ON public.registration_statuses FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid() AND status IN ('pending_registration','pending_training'));

CREATE POLICY "Admins can manage all statuses"
ON public.registration_statuses FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_registration_statuses_updated_at
BEFORE UPDATE ON public.registration_statuses
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.registration_statuses REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.registration_statuses;