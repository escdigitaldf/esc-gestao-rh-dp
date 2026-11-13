-- Enforce same-tenant and same-employee references for DSR scheduling data.
create unique index if not exists employee_work_schedules_org_employee_id_uidx
  on public.employee_work_schedules (organization_id, employee_id, id);

create unique index if not exists organization_holidays_org_id_uidx
  on public.organization_holidays (organization_id, id);

create unique index if not exists organization_dsr_rules_org_id_uidx
  on public.organization_dsr_rules (organization_id, id);

alter table public.employee_work_occurrences
  add constraint employee_work_occurrences_schedule_owner_fkey
  foreign key (organization_id, employee_id, work_schedule_id)
  references public.employee_work_schedules (organization_id, employee_id, id)
  on update restrict on delete restrict
  not valid;

alter table public.employee_work_occurrences
  add constraint employee_work_occurrences_holiday_org_fkey
  foreign key (organization_id, holiday_id)
  references public.organization_holidays (organization_id, id)
  on update restrict on delete set null (holiday_id)
  not valid;

alter table public.employee_work_schedules
  add constraint employee_work_schedules_dsr_rule_org_fkey
  foreign key (organization_id, dsr_rule_id)
  references public.organization_dsr_rules (organization_id, id)
  on update restrict on delete restrict
  not valid;

alter table public.employee_work_occurrences
  validate constraint employee_work_occurrences_schedule_owner_fkey;
alter table public.employee_work_occurrences
  validate constraint employee_work_occurrences_holiday_org_fkey;
alter table public.employee_work_schedules
  validate constraint employee_work_schedules_dsr_rule_org_fkey;