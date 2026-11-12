drop policy if exists "employee documents storage insert" on storage.objects;
create policy "employee documents storage insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'employee-documents'
  and exists (
    select 1
    from public.employee_documents d
    join public.organization_memberships m
      on m.organization_id = d.organization_id
    where d.storage_path = objects.name
      and d.organization_id::text = split_part(objects.name, '/', 1)
      and d.employee_id::text = split_part(objects.name, '/', 2)
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (
        m.role in ('owner', 'admin')
        or (m.role = 'hr_manager' and d.is_confidential = false)
      )
  )
);

drop policy if exists "employee documents storage update" on storage.objects;
create policy "employee documents storage update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'employee-documents'
  and exists (
    select 1
    from public.employee_documents d
    join public.organization_memberships m
      on m.organization_id = d.organization_id
    where d.storage_path = objects.name
      and d.organization_id::text = split_part(objects.name, '/', 1)
      and d.employee_id::text = split_part(objects.name, '/', 2)
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (
        m.role in ('owner', 'admin')
        or (m.role = 'hr_manager' and d.is_confidential = false)
      )
  )
)
with check (
  bucket_id = 'employee-documents'
  and exists (
    select 1
    from public.employee_documents d
    join public.organization_memberships m
      on m.organization_id = d.organization_id
    where d.storage_path = objects.name
      and d.organization_id::text = split_part(objects.name, '/', 1)
      and d.employee_id::text = split_part(objects.name, '/', 2)
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (
        m.role in ('owner', 'admin')
        or (m.role = 'hr_manager' and d.is_confidential = false)
      )
  )
);
