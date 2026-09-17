-- Face images captured during student registration
CREATE TABLE public.face_images (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id TEXT NOT NULL,
  student_code TEXT,
  student_name TEXT NOT NULL,
  pose TEXT NOT NULL,
  pose_label TEXT,
  kind TEXT NOT NULL DEFAULT 'original',
  variant INT NOT NULL DEFAULT 0,
  image_data TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_face_images_student ON public.face_images (student_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.face_images TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.face_images TO authenticated;
GRANT ALL ON public.face_images TO service_role;
ALTER TABLE public.face_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view face images" ON public.face_images FOR SELECT USING (true);
CREATE POLICY "Public can add face images" ON public.face_images FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can update face images" ON public.face_images FOR UPDATE USING (true);
CREATE POLICY "Public can delete face images" ON public.face_images FOR DELETE USING (true);

-- Training run history
CREATE TABLE public.training_runs (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  student_id TEXT,
  student_code TEXT,
  student_name TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  trigger TEXT,
  epochs INT,
  learning_rate DOUBLE PRECISION,
  batch_size INT,
  final_acc DOUBLE PRECISION,
  final_loss DOUBLE PRECISION,
  final_val_acc DOUBLE PRECISION,
  embedding_value DOUBLE PRECISION,
  dataset_size INT,
  metrics JSONB NOT NULL DEFAULT '[]',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_training_runs_student ON public.training_runs (student_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_runs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_runs TO authenticated;
GRANT ALL ON public.training_runs TO service_role;
ALTER TABLE public.training_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view training runs" ON public.training_runs FOR SELECT USING (true);
CREATE POLICY "Public can add training runs" ON public.training_runs FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can update training runs" ON public.training_runs FOR UPDATE USING (true);
CREATE POLICY "Public can delete training runs" ON public.training_runs FOR DELETE USING (true);