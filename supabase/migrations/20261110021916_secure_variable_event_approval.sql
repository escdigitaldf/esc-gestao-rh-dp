-- Secure variable-event approval lifecycle.
-- payroll_variable_events.amount is already a stored generated column:
-- round(quantity * unit_value, 2).

create or replace function public.guard_payroll_variable_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Sessão não autenticada.';
  end if;

  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.organization_memberships m
      where m.organization_id = new.organization_id
        and m.user_id = v_user_id and m.status = 'active'
        and m.role in ('owner', 'admin', 'hr_manager', 'payroll')
    ) then
      raise exception 'Usuário sem permissão para registrar eventos variáveis.';
    end if;
    if new.status <> 'pending' then
      raise exception 'Todo evento deve ser criado como pendente.';
    end if;
    new.approved_by := null;
    new.approved_at := null;
    new.processed_entry_id := null;
    return new;
  end if;

  if old.status <> 'pending' then
    raise exception 'Eventos aprovados, rejeitados ou processados não podem ser alterados.';
  end if;

  if new.organization_id <> old.organization_id
     or new.employee_id <> old.employee_id
     or new.competence <> old.competence then
    raise exception 'Organização, colaborador e competência não podem ser alterados.';
  end if;

  if new.status = 'processed'
     and coalesce(current_setting('app.payroll_event_processing', true), '') = 'on' then
    if new.processed_entry_id is null then
      raise exception 'O lançamento individual da folha é obrigatório para processar o evento.';
    end if;
    return new;
  end if;

  if new.status in ('approved', 'rejected') then
    if not exists (
      select 1 from public.organization_memberships m
      where m.organization_id = old.organization_id
        and m.user_id = v_user_id and m.status = 'active'
        and m.role in ('owner', 'admin', 'hr_manager', 'payroll')
    ) then
      raise exception 'Somente DP ou administração pode decidir sobre eventos variáveis.';
    end if;
    if new.code <> old.code
       or new.description <> old.description
       or new.item_type <> old.item_type
       or new.quantity <> old.quantity
       or new.unit_value <> old.unit_value
       or new.rubric_id is distinct from old.rubric_id
       or new.affects_inss <> old.affects_inss
       or new.affects_irrf <> old.affects_irrf
       or new.affects_fgts <> old.affects_fgts
       or new.affects_dsr <> old.affects_dsr then
      raise exception 'Os dados do evento não podem ser modificados durante a aprovação.';
    end if;
    new.approved_by := v_user_id;
    new.approved_at := now();
    new.processed_entry_id := null;
    return new;
  end if;

  if new.status <> 'pending' then
    raise exception 'Transição de situação inválida para evento variável.';
  end if;

  new.approved_by := null;
  new.approved_at := null;
  new.processed_entry_id := null;
  return new;
end;
$function$;

revoke all on function public.guard_payroll_variable_event() from public, anon, authenticated;

drop trigger if exists payroll_variable_event_guard on public.payroll_variable_events;
create trigger payroll_variable_event_guard
before insert or update on public.payroll_variable_events
for each row execute function public.guard_payroll_variable_event();

drop policy if exists payroll_variable_events_member_insert on public.payroll_variable_events;
create policy payroll_variable_events_authorized_insert
on public.payroll_variable_events for insert to authenticated
with check (
  exists (
    select 1 from public.organization_memberships m
    where m.organization_id = payroll_variable_events.organization_id
      and m.user_id = (select auth.uid()) and m.status = 'active'
      and m.role in ('owner', 'admin', 'hr_manager', 'payroll')
  )
);

drop policy if exists payroll_variable_events_member_update on public.payroll_variable_events;
create policy payroll_variable_events_authorized_update
on public.payroll_variable_events for update to authenticated
using (
  exists (
    select 1 from public.organization_memberships m
    where m.organization_id = payroll_variable_events.organization_id
      and m.user_id = (select auth.uid()) and m.status = 'active'
      and m.role in ('owner', 'admin', 'hr_manager', 'payroll')
  )
)
with check (
  exists (
    select 1 from public.organization_memberships m
    where m.organization_id = payroll_variable_events.organization_id
      and m.user_id = (select auth.uid()) and m.status = 'active'
      and m.role in ('owner', 'admin', 'hr_manager', 'payroll')
  )
);