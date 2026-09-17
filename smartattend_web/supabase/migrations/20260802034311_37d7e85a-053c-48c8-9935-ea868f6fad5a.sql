
CREATE TABLE IF NOT EXISTS public.face_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL UNIQUE,
  model_path text NOT NULL,
  class_map jsonb NOT NULL DEFAULT '[]'::jsonb,
  num_classes int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.face_models TO authenticated;
GRANT ALL ON public.face_models TO service_role;

ALTER TABLE public.face_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read face models" ON public.face_models;
CREATE POLICY "Authenticated read face models"
  ON public.face_models FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins manage face models" ON public.face_models;
CREATE POLICY "Admins manage face models"
  ON public.face_models FOR ALL TO authenticated
  USING (internal.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (internal.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated read face model files" ON storage.objects;
CREATE POLICY "Authenticated read face model files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'face-models');

DROP POLICY IF EXISTS "Admins upload face model files" ON storage.objects;
CREATE POLICY "Admins upload face model files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'face-models' AND internal.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins update face model files" ON storage.objects;
CREATE POLICY "Admins update face model files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'face-models' AND internal.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins delete face model files" ON storage.objects;
CREATE POLICY "Admins delete face model files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'face-models' AND internal.has_role(auth.uid(), 'admin'::app_role));
