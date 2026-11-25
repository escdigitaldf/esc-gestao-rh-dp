-- Validate absence ownership, dates and optional supporting document tenant integrity.
alter table public.employee_absences
  add constraint employee_absences_dates_chk
  check (end_date is null or end_date >= start_date);
create index if not exists employee_absences_org_period_idx
  on public.employee_absences(organization_id,start_date desc,status);
create index if not exists employee_absences_employee_period_idx
  on public.employee_absences(organization_id,employee_id,start_date desc);
create or replace function public.guard_employee_absence_record()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
 if new.end_date is not null and new.end_date < new.start_date then
  raise exception 'A data final do afastamento não pode ser anterior à data inicial.';
 end if;
 if not exists(select 1 from public.employees e where e.id=new.employee_id and e.organization_id=new.organization_id) then
  raise exception 'O colaborador não pertence à organização informada.';
 end if;
 if new.document_id is not null and not exists(
  select 1 from public.employee_documents d
  where d.id=new.document_id and d.organization_id=new.organization_id and d.employee_id=new.employee_id
 ) then
  raise exception 'O documento comprobatório deve pertencer ao mesmo colaborador e organização.';
 end if;
 new.updated_at:=now();
 return new;
end;
$$;
drop trigger if exists trg_guard_employee_absence_record on public.employee_absences;
create trigger trg_guard_employee_absence_record
before insert or update on public.employee_absences
for each row execute function public.guard_employee_absence_record();
