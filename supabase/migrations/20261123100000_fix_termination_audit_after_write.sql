-- Etapa 10: separar preparação de registros e persistência da trilha de auditoria.
-- Os registros de auditoria possuem FK para a linha principal; portanto, devem ser
-- inseridos em AFTER INSERT/UPDATE, quando a linha já existe.

create or replace function public.prepare_payroll_termination_case_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := auth.uid();

    if new.organization_id is distinct from old.organization_id
      or new.employee_id is distinct from old.employee_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'A organização, colaborador e autoria do processo rescisório são imutáveis.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.record_payroll_termination_case_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.payroll_termination_case_audit (
    organization_id, termination_case_id, action, old_record, new_record, actor_id
  ) values (
    new.organization_id, new.id, tg_op,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new), auth.uid()
  );

  return new;
end;
$$;

drop trigger if exists audit_payroll_termination_case_trigger
  on public.payroll_termination_cases;

create trigger prepare_payroll_termination_case_audit_trigger
before insert or update on public.payroll_termination_cases
for each row execute function public.prepare_payroll_termination_case_audit();

create trigger record_payroll_termination_case_audit_trigger
after insert or update on public.payroll_termination_cases
for each row execute function public.record_payroll_termination_case_audit();


create or replace function public.prepare_payroll_termination_item_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := auth.uid();

    if new.organization_id is distinct from old.organization_id
      or new.termination_case_id is distinct from old.termination_case_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'Organização, processo rescisório e autoria do item são imutáveis.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.record_payroll_termination_item_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.payroll_termination_calculation_item_audit (
    organization_id, calculation_item_id, termination_case_id,
    action, old_record, new_record, actor_id
  ) values (
    new.organization_id, new.id, new.termination_case_id,
    tg_op,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new), auth.uid()
  );

  return new;
end;
$$;

drop trigger if exists audit_payroll_termination_calculation_item_trigger
  on public.payroll_termination_calculation_items;

create trigger prepare_payroll_termination_item_audit_trigger
before insert or update on public.payroll_termination_calculation_items
for each row execute function public.prepare_payroll_termination_item_audit();

create trigger record_payroll_termination_item_audit_trigger
after insert or update on public.payroll_termination_calculation_items
for each row execute function public.record_payroll_termination_item_audit();


-- Revisores autorizados podem atualizar o processo criado por outro operador.
-- A autoria original permanece protegida pelo trigger BEFORE UPDATE.
drop policy if exists payroll_termination_cases_update on public.payroll_termination_cases;

create policy payroll_termination_cases_update
on public.payroll_termination_cases for update to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = payroll_termination_cases.organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role = any(array['owner','admin','hr_manager','payroll'])
))
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = payroll_termination_cases.organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any(array['owner','admin','hr_manager','payroll'])
  )
  and exists (
    select 1 from public.employees e
    where e.id = payroll_termination_cases.employee_id
      and e.organization_id = payroll_termination_cases.organization_id
  )
);

comment on function public.record_payroll_termination_case_audit() is
'Persiste a trilha de auditoria após a gravação do processo, garantindo que a FK da linha auditada já exista.';

comment on function public.record_payroll_termination_item_audit() is
'Persiste a trilha de auditoria após a gravação do item, garantindo que a FK da linha auditada já exista.';
