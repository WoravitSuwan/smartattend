GRANT SELECT, INSERT, UPDATE, DELETE ON public.face_images TO authenticated;
GRANT ALL ON public.face_images TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.registration_statuses TO authenticated;
GRANT ALL ON public.registration_statuses TO service_role;