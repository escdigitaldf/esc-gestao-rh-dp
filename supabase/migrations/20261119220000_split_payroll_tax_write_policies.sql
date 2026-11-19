-- Remove overlapping permissive SELECT policies without broadening write access.
-- Read access remains available to active organization members; mutations remain
-- restricted to owner/admin/hr_manager/payroll.
do $migration$
declare
  v_table text;
  v_policy text;
begin
  foreach v_table in array array[
    'employee_payroll_activity_classifications',
    'employee_payroll_lotation_assignments',
    'organization_payroll_activity_revenue',
    'organization_payroll_employer_settings',
    'organization_payroll_tax_lotations'
  ] loop
    v_policy := case
      when v_table = 'organization_payroll_tax_lotations' then 'payroll_tax_lotations_write'
      else v_table || '_write'
    end;

    execute format('drop policy if exists %I on public.%I',v_policy,v_table);

    execute format(
      'create policy %I on public.%I for insert to authenticated with check (
        exists (
          select 1 from public.organization_memberships m
          where m.organization_id = organization_id
            and m.user_id = (select auth.uid())
            and m.status = ''active''
            and m.role = any (array[''owner'',''admin'',''hr_manager'',''payroll''])
        )
      )',
      v_table || '_insert',v_table
    );

    execute format(
      'create policy %I on public.%I for update to authenticated using (
        exists (
          select 1 from public.organization_memberships m
          where m.organization_id = organization_id
            and m.user_id = (select auth.uid())
            and m.status = ''active''
            and m.role = any (array[''owner'',''admin'',''hr_manager'',''payroll''])
        )
      ) with check (
        exists (
          select 1 from public.organization_memberships m
          where m.organization_id = organization_id
            and m.user_id = (select auth.uid())
            and m.status = ''active''
            and m.role = any (array[''owner'',''admin'',''hr_manager'',''payroll''])
        )
      )',
      v_table || '_update',v_table
    );

    execute format(
      'create policy %I on public.%I for delete to authenticated using (
        exists (
          select 1 from public.organization_memberships m
          where m.organization_id = organization_id
            and m.user_id = (select auth.uid())
            and m.status = ''active''
            and m.role = any (array[''owner'',''admin'',''hr_manager'',''payroll''])
        )
      )',
      v_table || '_delete',v_table
    );
  end loop;
end;
$migration$;
