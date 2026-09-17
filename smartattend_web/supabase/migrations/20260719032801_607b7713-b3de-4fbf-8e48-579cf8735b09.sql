CREATE POLICY "Admins view all user_roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (internal.has_role(auth.uid(), 'admin'::public.app_role));