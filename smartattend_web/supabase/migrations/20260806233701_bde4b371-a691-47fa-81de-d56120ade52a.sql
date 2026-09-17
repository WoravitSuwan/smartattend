CREATE POLICY "Students manage own assignment files"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'assignment-files' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'assignment-files' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Instructors read assignment files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'assignment-files'
  AND EXISTS (
    SELECT 1 FROM public.assignment_submissions s
    JOIN public.assignments a ON a.id = s.assignment_id
    WHERE s.file_path = storage.objects.name
      AND public.is_course_instructor(a.course_id, auth.uid())
  )
);