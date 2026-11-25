-- Prevent forged, partial-month and concurrent duplicate benefit payroll events.
-- The existing payroll_variable_event_guard serializes writes by organization and competence.
-- This trigger reuses that transaction-scoped lock and validates the benefit source snapshot.

create or replace function public.guard_esc_benefit_event_idempotency()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_assignment_id uuid;
  v_assignment public.employee_benefit_assignments%rowtype;
  v_benefit public.benefit_types%rowtype;
  v_event_kind text;
  v_month_end date;
begin
  if new.notes is null or new.notes not like 'ESC_BENEFIT:%' then
    return new;
  end if;

  if new.competence <> date_trunc('month', new.competence)::date then
    raise exception 'A competência do benefício deve ser informada pelo primeiro dia do mês.';
  end if;

  if split_part(new.notes, ':', 2) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'A origem do evento de benefício é inválida.';
  end if;

  v_assignment_id := split_part(new.notes, ':', 2)::uuid;
  v_event_kind := split_part(new.notes, ':', 3);
  v_month_end := (date_trunc('month', new.competence)::date + interval '1 month - 1 day')::date;

  select a.*
    into v_assignment
  from public.employee_benefit_assignments a
  where a.id = v_assignment_id
    and a.organization_id = new.organization_id
    and a.employee_id = new.employee_id
    and a.status = 'active'
    and a.effective_from <= new.competence
    and (a.effective_to is null or a.effective_to >= v_month_end);

  if not found then
    raise exception 'A atribuição do benefício não está ativa ou não cobre integralmente a competência.';
  end if;

  select b.*
    into v_benefit
  from public.benefit_types b
  where b.id = v_assignment.benefit_type_id
    and b.organization_id = new.organization_id
    and b.is_active;

  if not found then
    raise exception 'O tipo de benefício não está ativo ou não pertence à organização.';
  end if;

  if new.quantity <> 1 then
    raise exception 'A geração automática de benefício exige quantidade unitária; ajuste especial deve ser revisado manualmente.';
  end if;

  if v_event_kind = 'employee_deduction' then
    if v_benefit.employee_deduction_rubric_id is null
       or new.rubric_id is distinct from v_benefit.employee_deduction_rubric_id
       or new.item_type <> 'deduction'
       or new.unit_value <> v_assignment.employee_amount then
      raise exception 'O evento de desconto não corresponde à atribuição e à rubrica homologada.';
    end if;
  elsif v_event_kind = 'employer_cost' then
    if v_benefit.employer_cost_rubric_id is null
       or new.rubric_id is distinct from v_benefit.employer_cost_rubric_id
       or new.item_type <> 'employer_charge'
       or new.unit_value <> v_assignment.employer_amount then
      raise exception 'O evento de custo empresarial não corresponde à atribuição e à rubrica homologada.';
    end if;
  else
    raise exception 'Tipo de evento de benefício inválido.';
  end if;

  -- Keep the same lock key used by payroll_variable_event_guard.
  perform pg_advisory_xact_lock(
    hashtextextended(new.organization_id::text || ':' || new.competence::text, 0)
  );

  if exists (
    select 1
    from public.payroll_variable_events e
    where e.organization_id = new.organization_id
      and e.competence = new.competence
      and e.notes = new.notes
      and e.status <> 'rejected'
  ) then
    raise exception 'Este evento de benefício já foi gerado para a atribuição e competência informadas.'
      using errcode = '23505';
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_esc_benefit_event_idempotency() from public, anon, authenticated;

drop trigger if exists zz_guard_esc_benefit_event_idempotency on public.payroll_variable_events;
create trigger zz_guard_esc_benefit_event_idempotency
before insert on public.payroll_variable_events
for each row
execute function public.guard_esc_benefit_event_idempotency();

create index if not exists payroll_variable_events_esc_benefit_source_idx
on public.payroll_variable_events (organization_id, competence, notes)
where notes like 'ESC_BENEFIT:%' and status <> 'rejected';
