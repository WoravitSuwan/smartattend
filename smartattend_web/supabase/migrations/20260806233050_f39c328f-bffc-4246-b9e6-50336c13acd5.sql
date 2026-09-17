CREATE POLICY "Students manage own leave attachments"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'leave-attachments' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'leave-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Instructors read leave attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'leave-attachments'
  AND EXISTS (
    SELECT 1 FROM public.leave_requests lr
    WHERE lr.attachment_path = storage.objects.name
      AND public.is_course_instructor(lr.course_id, auth.uid())
  )
);