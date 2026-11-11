-- Auditable validation for employee work schedules used by DSR.
alter table public.employee_work_schedules
  add column if not exists dsr_rule_validated_by uuid references auth.users(id) on delete set null,
  add column if not exists dsr_rule_validated_at timestamptz;

create or replace function public.guard_employee_work_schedule_dsr_validation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rule public.organization_dsr_rules%rowtype;
  v_pattern_count integer;
  v_work_count integer;
  v_rest_count integer;
begin
  if tg_op = 'INSERT' then
    if new.dsr_rule_status <> 'pending_validation' then
      raise exception 'Nova escala deve iniciar pendente de validação.';
    end if;
    if new.dsr_rule_validated_by is not null or new.dsr_rule_validated_at is not null then
      raise exception 'Nova escala não pode conter dados de validação prévios.';
    end if;
  elsif tg_op = 'UPDATE' then
    if old.organization_id <> new.organization_id or old.employee_id <> new.employee_id then
      raise exception 'Não é permitido transferir uma escala para outro colaborador ou organização.';
    end if;
    if old.dsr_rule_status = 'validated' and (
      new.schedule_name is distinct from old.schedule_name or
      new.schedule_type is distinct from old.schedule_type or
      new.effective_from is distinct from old.effective_from or
      new.effective_to is distinct from old.effective_to or
      new.work_days is distinct from old.work_days or
      new.weekly_rest_days is distinct from old.weekly_rest_days or
      new.weekly_hours is distinct from old.weekly_hours or
      new.cycle_days is distinct from old.cycle_days or
      new.cycle_pattern is distinct from old.cycle_pattern or
      new.dsr_rule_id is distinct from old.dsr_rule_id
    ) then
      raise exception 'Escala validada não pode ser alterada. Cadastre nova vigência para preservar o histórico.';
    end if;
    if old.dsr_rule_status = 'validated' and new.dsr_rule_status <> 'validated' then
      raise exception 'Uma escala validada não pode voltar para pendente. Cadastre nova vigência ou solicite suspensão administrativa.';
    end if;
    if old.dsr_rule_status <> 'validated' and new.dsr_rule_status = 'validated' then
      if new.dsr_rule_validated_by is distinct from (select auth.uid()) or new.dsr_rule_validated_at is null then
        raise exception 'A validação da escala exige identificação do responsável e data.';
      end if;
    end if;
  end if;

  if new.dsr_rule_status = 'validated' then
    if new.dsr_rule_id is null then
      raise exception 'Vincule uma regra legal ou coletiva validada antes de validar a escala.';
    end if;

    select * into v_rule
    from public.organization_dsr_rules r
    where r.id = new.dsr_rule_id
      and r.organization_id = new.organization_id;

    if not found or v_rule.status <> 'validated' then
      raise exception 'A regra vinculada não está validada ou não pertence à organização.';
    end if;
    if v_rule.validity_from is not null and new.effective_from < v_rule.validity_from then
      raise exception 'A vigência da escala começa antes da vigência da regra normativa.';
    end if;
    if v_rule.validity_to is not null and (new.effective_to is null or new.effective_to > v_rule.validity_to) then
      raise exception 'A vigência da escala ultrapassa a validade da regra normativa.';
    end if;

    if new.schedule_type = 'fixed_weekly' then
      if cardinality(new.work_days) = 0 or cardinality(new.weekly_rest_days) = 0 then
        raise exception 'Informe ao menos um dia de trabalho e um dia de repouso.';
      end if;
      if new.work_days && new.weekly_rest_days then
        raise exception 'Um mesmo dia da semana não pode ser simultaneamente trabalho e repouso.';
      end if;
    else
      if new.cycle_days is null or jsonb_typeof(new.cycle_pattern) <> 'array' then
        raise exception 'Informe a duração e o padrão do ciclo da jornada.';
      end if;
      select count(*) into v_pattern_count from jsonb_array_elements(new.cycle_pattern);
      select count(*) into v_work_count from jsonb_array_elements_text(new.cycle_pattern) as x(value) where x.value = 'work';
      select count(*) into v_rest_count from jsonb_array_elements_text(new.cycle_pattern) as x(value) where x.value = 'rest';
      if v_pattern_count <> new.cycle_days or v_work_count = 0 or v_rest_count = 0 or
         exists (select 1 from jsonb_array_elements_text(new.cycle_pattern) as x(value) where x.value not in ('work','rest')) then
        raise exception 'O padrão do ciclo deve ter exatamente a quantidade de dias informada e conter somente trabalho (T) ou repouso (R), com ambos presentes.';
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_employee_work_schedule_dsr_validation on public.employee_work_schedules;
create trigger trg_guard_employee_work_schedule_dsr_validation
before insert or update on public.employee_work_schedules
for each row execute function public.guard_employee_work_schedule_dsr_validation();

revoke all on function public.guard_employee_work_schedule_dsr_validation() from public, anon;
