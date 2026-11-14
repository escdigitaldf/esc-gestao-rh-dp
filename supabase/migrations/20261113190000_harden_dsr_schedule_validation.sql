-- Human-reviewed DSR schedule approval with immutable audit metadata.
alter table public.employee_work_schedules
  add column if not exists dsr_validated_by uuid references auth.users(id) on delete set null,
  add column if not exists dsr_validated_at timestamptz;

alter table public.employee_work_schedules
  drop constraint if exists employee_work_schedules_dsr_validation_audit_check;

alter table public.employee_work_schedules
  add constraint employee_work_schedules_dsr_validation_audit_check
  check (dsr_rule_status <> 'validated' or (dsr_validated_by is not null and dsr_validated_at is not null));

create or replace function public.guard_employee_work_schedule_dsr_validation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rule public.organization_dsr_rules%rowtype;
begin
  if tg_op = 'UPDATE' and old.dsr_rule_status = 'validated' then
    if new.dsr_rule_status not in ('validated','suspended') then
      raise exception 'Uma escala validada não pode voltar a pendente. Suspenda-a e cadastre uma nova versão.';
    end if;
    if new.dsr_rule_status = 'validated' and (
      new.organization_id is distinct from old.organization_id or
      new.employee_id is distinct from old.employee_id or
      new.schedule_name is distinct from old.schedule_name or
      new.schedule_type is distinct from old.schedule_type or
      new.effective_from is distinct from old.effective_from or
      new.effective_to is distinct from old.effective_to or
      new.work_days is distinct from old.work_days or
      new.weekly_rest_days is distinct from old.weekly_rest_days or
      new.weekly_hours is distinct from old.weekly_hours or
      new.cycle_days is distinct from old.cycle_days or
      new.cycle_pattern is distinct from old.cycle_pattern or
      new.dsr_rule_id is distinct from old.dsr_rule_id or
      new.dsr_rule_notes is distinct from old.dsr_rule_notes
    ) then
      raise exception 'Escala validada é imutável. Suspenda-a e cadastre uma nova versão para alterar a jornada.';
    end if;
  end if;

  if new.dsr_rule_status = 'validated' and (tg_op = 'INSERT' or old.dsr_rule_status is distinct from 'validated') then
    if new.dsr_rule_id is null then
      raise exception 'Vincule uma regra normativa validada antes de aprovar a escala.';
    end if;
    select * into v_rule
    from public.organization_dsr_rules r
    where r.id = new.dsr_rule_id
      and r.organization_id = new.organization_id
      and r.status = 'validated';
    if not found then
      raise exception 'A regra normativa vinculada não existe, pertence a outra organização ou não está validada.';
    end if;
    if v_rule.validity_from is not null and v_rule.validity_from > new.effective_from then
      raise exception 'A regra normativa começa depois do início da vigência da escala.';
    end if;
    if v_rule.validity_to is not null and (new.effective_to is null or v_rule.validity_to < new.effective_to) then
      raise exception 'A regra normativa não cobre toda a vigência da escala.';
    end if;
    if coalesce(array_length(new.work_days,1),0) = 0 or coalesce(array_length(new.weekly_rest_days,1),0) = 0 then
      raise exception 'Informe ao menos um dia de trabalho e um dia de repouso.';
    end if;
    if new.work_days && new.weekly_rest_days then
      raise exception 'Um mesmo dia não pode ser trabalho e repouso na mesma escala.';
    end if;
    if length(btrim(coalesce(new.dsr_rule_notes,''))) < 20 then
      raise exception 'A validação da escala exige justificativa técnica com pelo menos 20 caracteres.';
    end if;
    new.dsr_validated_by := (select auth.uid());
    new.dsr_validated_at := now();
    if new.dsr_validated_by is null then
      raise exception 'Não foi possível identificar o responsável pela validação da escala.';
    end if;
  elsif new.dsr_rule_status = 'pending_validation' then
    new.dsr_validated_by := null;
    new.dsr_validated_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_employee_work_schedule_dsr_validation on public.employee_work_schedules;
create trigger guard_employee_work_schedule_dsr_validation
before insert or update on public.employee_work_schedules
for each row execute function public.guard_employee_work_schedule_dsr_validation();

revoke all on function public.guard_employee_work_schedule_dsr_validation() from public, anon;
