-- Allow the uploader to remove only an unregistered orphan PDF after a
-- metadata insert failure. Registered DSR documents remain immutable.
drop policy if exists organization_dsr_docs_storage_delete_orphan
  on storage.objects;

create policy organization_dsr_docs_storage_delete_orphan
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'organization-dsr-documents'
    and owner = (select auth.uid())
    and exists (
      select 1
      from public.organization_dsr_rules r
      join public.organization_memberships m on m.organization_id = r.organization_id
      where r.id::text = (storage.foldername(objects.name))[2]
        and r.organization_id::text = (storage.foldername(objects.name))[1]
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and m.role in ('owner', 'admin', 'hr_manager', 'payroll')
    )
    and not exists (
      select 1
      from public.organization_dsr_rule_documents d
      where d.storage_path = objects.name
    )
  );
