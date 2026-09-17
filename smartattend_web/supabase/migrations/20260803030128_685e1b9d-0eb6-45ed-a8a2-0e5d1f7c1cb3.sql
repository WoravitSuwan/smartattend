-- 1) Backfill student_id from the owning auth user where it isn't already a uuid
UPDATE public.face_images
SET student_id = user_id::text
WHERE user_id IS NOT NULL
  AND student_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

-- 2) Remove rows that still can't be resolved to a real user
DELETE FROM public.face_images
WHERE student_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

DELETE FROM public.face_images
WHERE student_id::uuid NOT IN (SELECT id FROM auth.users);

-- 3) Convert to uuid
ALTER TABLE public.face_images
  ALTER COLUMN student_id TYPE uuid USING student_id::uuid;

-- 4) Cascade delete with the user account
ALTER TABLE public.face_images
  DROP CONSTRAINT IF EXISTS face_images_student_id_fkey;
ALTER TABLE public.face_images
  ADD CONSTRAINT face_images_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 5) Lock down access: no anon, owner + admin only
REVOKE ALL ON public.face_images FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.face_images TO authenticated;
GRANT ALL ON public.face_images TO service_role;

DROP POLICY IF EXISTS "Public can view face images" ON public.face_images;
DROP POLICY IF EXISTS "Public can insert face images" ON public.face_images;
DROP POLICY IF EXISTS "Public can update face images" ON public.face_images;
DROP POLICY IF EXISTS "Public can delete face images" ON public.face_images;
DROP POLICY IF EXISTS "Students manage own face images" ON public.face_images;
DROP POLICY IF EXISTS "Admins manage all face images" ON public.face_images;

CREATE POLICY "Students manage own face images" ON public.face_images
  FOR ALL TO authenticated
  USING (student_id = auth.uid() OR user_id = auth.uid())
  WITH CHECK (student_id = auth.uid() AND user_id = auth.uid());

CREATE POLICY "Admins manage all face images" ON public.face_images
  FOR ALL TO authenticated
  USING (internal.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (internal.has_role(auth.uid(), 'admin'::app_role));