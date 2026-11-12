create or replace function public.prevent_employee_tenant_reassignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'A organização de um registro funcional não pode ser alterada. Faça um procedimento de transferência autorizado.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists employees_prevent_tenant_reassignment on public.employees;
create trigger employees_prevent_tenant_reassignment
before update of organization_id on public.employees
for each row execute function public.prevent_employee_tenant_reassignment();

drop trigger if exists employee_dependents_prevent_tenant_reassignment on public.employee_dependents;
create trigger employee_dependents_prevent_tenant_reassignment
before update of organization_id on public.employee_dependents
for each row execute function public.prevent_employee_tenant_reassignment();

drop trigger if exists employee_documents_prevent_tenant_reassignment on public.employee_documents;
create trigger employee_documents_prevent_tenant_reassignment
before update of organization_id on public.employee_documents
for each row execute function public.prevent_employee_tenant_reassignment();
