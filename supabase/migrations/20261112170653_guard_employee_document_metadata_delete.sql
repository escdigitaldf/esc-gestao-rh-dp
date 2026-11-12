CREATE OR REPLACE FUNCTION public.guard_employee_document_metadata_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM storage.objects AS o
    WHERE o.bucket_id = 'employee-documents'
      AND o.name = OLD.storage_path
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'O arquivo ainda existe no Storage. Remova-o pela API do Storage antes de excluir o registro documental.';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_employee_document_metadata_delete() FROM PUBLIC;

DROP TRIGGER IF EXISTS guard_employee_document_metadata_delete
  ON public.employee_documents;

CREATE TRIGGER guard_employee_document_metadata_delete
BEFORE DELETE ON public.employee_documents
FOR EACH ROW
EXECUTE FUNCTION public.guard_employee_document_metadata_delete();
