-- Let an instructor attach a reference file to an assignment when posting
-- it (separate from assignment_submissions.file_path, which is what a
-- student uploads back). Reuses the existing assignment-files bucket and
-- its per-uploader-folder policy — an instructor writing to
-- assignment-files/{their own uid}/... is already allowed by "Students
-- manage own assignment files" (that policy is keyed on auth.uid(), not
-- actually role-restricted despite the name).
ALTER TABLE public.assignments
  ADD COLUMN attachment_path text,
  ADD COLUMN attachment_name text;

-- Students still need a way to read a file that lives under the
-- instructor's own uid folder, though — the existing storage policies
-- only cover the uploader themselves or an instructor reading back a
-- student's submission. Grant read access when the file is the
-- attachment of an assignment in a course the student is confirmed into.
CREATE POLICY "Students can read assignment attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'assignment-files'
  AND EXISTS (
    SELECT 1 FROM public.assignments a
    JOIN public.course_enrollments ce ON ce.course_id = a.course_id
    WHERE a.attachment_path = storage.objects.name
      AND ce.student_id = auth.uid()
      AND ce.status = 'confirmed'
  )
);
