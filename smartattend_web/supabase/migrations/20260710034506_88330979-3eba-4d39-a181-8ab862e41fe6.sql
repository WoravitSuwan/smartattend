
-- has_role function (security definer to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- student_courses table
CREATE TABLE IF NOT EXISTS public.student_courses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  section TEXT,
  credits TEXT,
  schedule TEXT,
  room TEXT,
  instructor TEXT,
  source TEXT DEFAULT 'pdf',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_courses TO authenticated;
GRANT ALL ON public.student_courses TO service_role;
ALTER TABLE public.student_courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own courses" ON public.student_courses
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view all courses" ON public.student_courses
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP TRIGGER IF EXISTS trg_student_courses_updated ON public.student_courses;
CREATE TRIGGER trg_student_courses_updated
  BEFORE UPDATE ON public.student_courses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Wipe all except admin
DO $$
DECLARE
  admin_id UUID;
BEGIN
  SELECT id INTO admin_id FROM auth.users WHERE email = 'admin@rmutl.ac.th' LIMIT 1;

  DELETE FROM public.face_images;
  DELETE FROM public.registration_statuses;
  DELETE FROM public.training_runs;
  DELETE FROM public.student_courses;

  IF admin_id IS NOT NULL THEN
    DELETE FROM public.profiles WHERE user_id <> admin_id;
    DELETE FROM public.user_roles WHERE user_id <> admin_id;
    DELETE FROM auth.users WHERE id <> admin_id;
  ELSE
    DELETE FROM public.profiles;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
  END IF;
END $$;
