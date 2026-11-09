-- Harden the persisted vacation review workflow.
drop policy if exists payroll_vacation_reviews_update on public.payroll_vacation_reviews;
revoke update on public.payroll_vacation_reviews from authenticated;

create or replace function public.guard_payroll_vacation_review()
returns trigger language plpgsql set search_path=public as $$
declare run_status text; schedule_status text; schedule_employee uuid; entry_employee uuid; history_employee uuid; history_salary numeric; history_type text; history_from date; history_to date;
begin
 if tg_op='DELETE' then
  select status into run_status from public.payroll_runs where id=old.payroll_run_id and organization_id=old.organization_id;
  if run_status='closed' then raise exception 'Não é permitido alterar conferências de férias de uma competência fechada.'; end if;
  return old;
 end if;
 select status into run_status from public.payroll_runs where id=new.payroll_run_id and organization_id=new.organization_id;
 if run_status is null then raise exception 'Competência da folha não encontrada.'; end if;
 if run_status in ('closed','cancelled') then raise exception 'A conferência de férias exige uma competência aberta.'; end if;
 select status,employee_id into schedule_status,schedule_employee from public.employee_vacation_schedules where id=new.vacation_schedule_id and organization_id=new.organization_id;
 if schedule_status is distinct from 'approved' or schedule_employee is distinct from new.employee_id then raise exception 'A programação deve estar aprovada e pertencer ao colaborador informado.'; end if;
 select employee_id into entry_employee from public.payroll_entries where id=new.payroll_entry_id and payroll_run_id=new.payroll_run_id and organization_id=new.organization_id;
 if entry_employee is distinct from new.employee_id then raise exception 'O lançamento da folha deve pertencer ao mesmo colaborador e competência.'; end if;
 select employee_id,salary_amount,salary_type,effective_from,effective_to into history_employee,history_salary,history_type,history_from,history_to from public.employee_salary_history where id=new.salary_history_id and organization_id=new.organization_id;
 if history_employee is distinct from new.employee_id or history_type is distinct from 'monthly' or history_salary is distinct from new.salary_amount or history_from>new.reference_date or (history_to is not null and history_to<new.reference_date) then raise exception 'O histórico salarial informado não corresponde ao colaborador ou à data de referência.'; end if;
 return new;
end; $$;

create or replace function public.prevent_reviewed_vacation_schedule_changes()
returns trigger language plpgsql set search_path=public as $$
begin
 if exists(select 1 from public.payroll_vacation_reviews r where r.organization_id=old.organization_id and r.vacation_schedule_id=old.id and r.status in ('reviewed','posted')) then
  raise exception 'Esta programação já foi conferida na folha. Cancele a conferência por procedimento autorizado antes de alterar as férias.';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;

drop trigger if exists employee_vacation_schedule_review_lock on public.employee_vacation_schedules;
create trigger employee_vacation_schedule_review_lock before update or delete on public.employee_vacation_schedules for each row execute function public.prevent_reviewed_vacation_schedule_changes();
