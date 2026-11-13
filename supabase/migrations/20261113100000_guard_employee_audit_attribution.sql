-- Preserve the original actor attribution and immutable Storage object key.
-- Nullable actor FKs may still be set to NULL by ON DELETE SET NULL when an
-- auth user is removed; reassignment to another actor is rejected.

create or replace function public.guard_employee_audit_attribution()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_field text := tg_argv[0];
  v_old text;
  v_new text;
begin
  v_old := to_jsonb(old) ->> v_field;
  v_new := to_jsonb(new) ->> v_field;

  if v_field = 'storage_path' then
    if v_old is distinct from v_new then
      raise exception 'O caminho do documento armazenado é imutável após o envio.'
        using errcode = '23514';
    end if;
  elsif v_old is not null and v_new is not null and v_old is distinct from v_new then
    raise exception 'A autoria original do registro não pode ser substituída.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists employees_guard_created_by on public.employees;
create trigger employees_guard_created_by
before update of created_by on public.employees
for each row execute function public.guard_employee_audit_attribution('created_by');

drop trigger if exists employee_dependents_guard_created_by on public.employee_dependents;
create trigger employee_dependents_guard_created_by
before update of created_by on public.employee_dependents
for each row execute function public.guard_employee_audit_attribution('created_by');

drop trigger if exists employee_work_schedules_guard_created_by on public.employee_work_schedules;
create trigger employee_work_schedules_guard_created_by
before update of created_by on public.employee_work_schedules
for each row execute function public.guard_employee_audit_attribution('created_by');

drop trigger if exists employee_work_occurrences_guard_created_by on public.employee_work_occurrences;
create trigger employee_work_occurrences_guard_created_by
before update of created_by on public.employee_work_occurrences
for each row execute function public.guard_employee_audit_attribution('created_by');

drop trigger if exists employee_documents_guard_uploaded_by on public.employee_documents;
create trigger employee_documents_guard_uploaded_by
before update of uploaded_by on public.employee_documents
for each row execute function public.guard_employee_audit_attribution('uploaded_by');

drop trigger if exists employee_documents_guard_storage_path on public.employee_documents;
create trigger employee_documents_guard_storage_path
before update of storage_path on public.employee_documents
for each row execute function public.guard_employee_audit_attribution('storage_path');