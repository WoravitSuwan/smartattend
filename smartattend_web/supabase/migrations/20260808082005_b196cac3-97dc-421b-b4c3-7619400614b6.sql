
-- 1. face_images: remove permissive ALL policy, add strict UPDATE policy
DROP POLICY IF EXISTS "Students manage own face images" ON public.face_images;

CREATE POLICY "Students update own face images"
ON public.face_images FOR UPDATE TO authenticated
USING (student_id = auth.uid() AND user_id = auth.uid())
WITH CHECK (student_id = auth.uid() AND user_id = auth.uid());

DROP POLICY IF EXISTS "Students can add own face images" ON public.face_images;
CREATE POLICY "Students can add own face images"
ON public.face_images FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND student_id = auth.uid());

DROP POLICY IF EXISTS "Owners and admins can delete face images" ON public.face_images;
CREATE POLICY "Owners and admins can delete face images"
ON public.face_images FOR DELETE TO authenticated
USING ((user_id = auth.uid() AND student_id = auth.uid()) OR internal.has_role(auth.uid(), 'admin'::app_role));

-- 2. face_models: restrict metadata reads
CREATE OR REPLACE FUNCTION public.can_use_face_model(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT internal.has_role(_user_id, 'admin'::app_role)
      OR internal.has_role(_user_id, 'instructor'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.registration_statuses rs
        WHERE rs.user_id = _user_id AND rs.status = 'training_success'
      )
$$;

REVOKE ALL ON FUNCTION public.can_use_face_model(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_use_face_model(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Authenticated read face models" ON public.face_models;
CREATE POLICY "Eligible users read active face models"
ON public.face_models FOR SELECT TO authenticated
USING (is_active = true AND public.can_use_face_model(auth.uid()));

-- 3. storage bucket face-models: restrict file reads the same way
DROP POLICY IF EXISTS "Authenticated read face model files" ON storage.objects;
CREATE POLICY "Eligible users read face model files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'face-models'
  AND public.can_use_face_model(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.face_models fm
    WHERE fm.is_active = true
      AND (storage.foldername(objects.name))[1] = fm.model_path
  )
);
