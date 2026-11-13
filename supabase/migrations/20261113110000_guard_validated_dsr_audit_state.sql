-- Make decision metadata append-only after a DSR decision has been recorded.
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
  elsif v_field in ('validated_by', 'validated_at', 'dsr_rule_validated_by', 'dsr_rule_validated_at') then
    if v_old is not null and v_old is distinct from v_new then
      raise exception 'Os dados de validação registrados não podem ser alterados ou apagados.'
        using errcode = '23514';
    end if;
  elsif v_old is not null and v_new is not null and v_old is distinct from v_new then
    raise exception 'A autoria original do registro não pode ser substituída.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.guard_validated_employee_work_occurrence_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.record_status = 'validated' and (
    new.record_status is distinct from old.record_status
    or new.validated_by is distinct from old.validated_by
    or new.validated_at is distinct from old.validated_at
  ) then
    raise exception 'Uma ocorrência validada não pode ter seu status ou dados de validação revertidos. Utilize retificação auditável.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists employee_work_occurrences_guard_validated_by on public.employee_work_occurrences;
create trigger employee_work_occurrences_guard_validated_by
before update of validated_by on public.employee_work_occurrences
for each row execute function public.guard_employee_audit_attribution('validated_by');

drop trigger if exists employee_work_occurrences_guard_validated_at on public.employee_work_occurrences;
create trigger employee_work_occurrences_guard_validated_at
before update of validated_at on public.employee_work_occurrences
for each row execute function public.guard_employee_audit_attribution('validated_at');

drop trigger if exists employee_work_schedules_guard_dsr_rule_validated_by on public.employee_work_schedules;
create trigger employee_work_schedules_guard_dsr_rule_validated_by
before update of dsr_rule_validated_by on public.employee_work_schedules
for each row execute function public.guard_employee_audit_attribution('dsr_rule_validated_by');

drop trigger if exists employee_work_schedules_guard_dsr_rule_validated_at on public.employee_work_schedules;
create trigger employee_work_schedules_guard_dsr_rule_validated_at
before update of dsr_rule_validated_at on public.employee_work_schedules
for each row execute function public.guard_employee_audit_attribution('dsr_rule_validated_at');

drop trigger if exists zzzz_guard_validated_employee_work_occurrence_state on public.employee_work_occurrences;
create trigger zzzz_guard_validated_employee_work_occurrence_state
before update of record_status, validated_by, validated_at on public.employee_work_occurrences
for each row execute function public.guard_validated_employee_work_occurrence_state();