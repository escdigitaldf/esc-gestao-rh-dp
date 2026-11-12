DROP POLICY IF EXISTS "employee documents storage delete" ON storage.objects;

CREATE POLICY "employee documents storage delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'employee-documents'
  AND EXISTS (
    SELECT 1
    FROM public.employee_documents d
    JOIN public.organization_memberships m
      ON m.organization_id = d.organization_id
    WHERE d.storage_path = objects.name
      AND m.user_id = (SELECT auth.uid())
      AND m.status = 'active'
      AND (
        m.role IN ('owner', 'admin')
        OR (m.role = 'hr_manager' AND d.is_confidential = false)
      )
  )
);
