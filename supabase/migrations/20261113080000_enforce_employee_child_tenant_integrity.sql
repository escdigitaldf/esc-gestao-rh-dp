-- Enforce tenant ownership at the relational layer for employee-owned records.
-- The existing single-column employee_id foreign keys remain in place; these
-- composite keys additionally guarantee that the employee belongs to the
-- same organization stored on each child row.

create unique index if not exists employees_organization_id_id_uidx
  on public.employees (organization_id, id);

alter table public.employee_dependents
  add constraint employee_dependents_employee_org_fkey
  foreign key (organization_id, employee_id)
  references public.employees (organization_id, id)
  on update restrict on delete cascade
  not valid;

alter table public.employee_documents
  add constraint employee_documents_employee_org_fkey
  foreign key (organization_id, employee_id)
  references public.employees (organization_id, id)
  on update restrict on delete cascade
  not valid;

alter table public.employee_work_schedules
  add constraint employee_work_schedules_employee_org_fkey
  foreign key (organization_id, employee_id)
  references public.employees (organization_id, id)
  on update restrict on delete cascade
  not valid;

alter table public.employee_work_occurrences
  add constraint employee_work_occurrences_employee_org_fkey
  foreign key (organization_id, employee_id)
  references public.employees (organization_id, id)
  on update restrict on delete cascade
  not valid;

alter table public.employee_dependents
  validate constraint employee_dependents_employee_org_fkey;
alter table public.employee_documents
  validate constraint employee_documents_employee_org_fkey;
alter table public.employee_work_schedules
  validate constraint employee_work_schedules_employee_org_fkey;
alter table public.employee_work_occurrences
  validate constraint employee_work_occurrences_employee_org_fkey;
