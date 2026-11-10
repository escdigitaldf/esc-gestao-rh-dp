create or replace function public.guard_employee_work_occurrence()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare v_run_status text;
begin
  if tg_op = 'DELETE' then
    perform pg_advisory_xact_lock(hashtextextended(old.organization_id::text || ':' || to_char(old.occurrence_date,'YYYY-MM'), 0));
    select r.status into v_run_status from public.payroll_runs r where r.organization_id = old.organization_id and r.reference_month = date_trunc('month', old.occurrence_date)::date and r.status = 'closed' limit 1;
    if v_run_status is not null then raise exception 'Não é permitido excluir ocorrência de competência com folha fechada.'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' and new.record_status <> 'draft' then raise exception 'Novas ocorrências devem iniciar como rascunho e ser validadas em etapa própria.'; end if;
  if tg_op = 'UPDATE' and old.record_status = 'validated' and (
    new.organization_id is distinct from old.organization_id or new.employee_id is distinct from old.employee_id or
    new.work_schedule_id is distinct from old.work_schedule_id or new.occurrence_date is distinct from old.occurrence_date or
    new.occurrence_type is distinct from old.occurrence_type or new.scheduled_hours is distinct from old.scheduled_hours or
    new.worked_hours is distinct from old.worked_hours or new.holiday_id is distinct from old.holiday_id or new.notes is distinct from old.notes
  ) then raise exception 'Ocorrência validada é imutável. Registre ajuste por procedimento de retificação auditável.'; end if;
  if not exists (select 1 from public.employees e where e.id = new.employee_id and e.organization_id = new.organization_id) then raise exception 'O colaborador não pertence à organização informada.'; end if;
  if not exists (select 1 from public.employee_work_schedules s where s.id = new.work_schedule_id and s.organization_id = new.organization_id and s.employee_id = new.employee_id and s.effective_from <= new.occurrence_date and (s.effective_to is null or s.effective_to >= new.occurrence_date)) then raise exception 'Não existe escala vigente para o colaborador na data da ocorrência.'; end if;
  if new.holiday_id is not null and not exists (select 1 from public.organization_holidays h where h.id = new.holiday_id and h.organization_id = new.organization_id and h.holiday_date = new.occurrence_date) then raise exception 'O feriado selecionado não corresponde à data e organização da ocorrência.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text || ':' || to_char(new.occurrence_date,'YYYY-MM'), 0));
  select r.status into v_run_status from public.payroll_runs r where r.organization_id = new.organization_id and r.reference_month = date_trunc('month', new.occurrence_date)::date and r.status = 'closed' limit 1;
  if v_run_status is not null then raise exception 'Não é permitido alterar ocorrência de competência com folha fechada.'; end if;
  if tg_op = 'UPDATE' and new.record_status = 'validated' and old.record_status is distinct from 'validated' then new.validated_by := (select auth.uid()); new.validated_at := now();
  elsif new.record_status <> 'validated' then new.validated_by := null; new.validated_at := null; end if;
  new.updated_at := now();
  return new;
end;
$$;