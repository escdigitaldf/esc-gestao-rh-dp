-- Controlled workflow for recording, paying and reversing the first 13th-salary installment.
-- Client roles have no direct write access to the register; all writes pass through authenticated RPCs.

create or replace function public.validate_payroll_thirteenth_advance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_org uuid;
  v_run_org uuid;
  v_run_type text;
  v_run_year integer;
begin
  select e.organization_id into v_employee_org
  from public.employees e where e.id = new.employee_id;

  if v_employee_org is null or v_employee_org <> new.organization_id then
    raise exception 'Colaborador não pertence à organização informada.';
  end if;

  if new.payment_date < make_date(new.tax_year,1,1)
     or new.payment_date > make_date(new.tax_year,12,31) then
    raise exception 'A data do adiantamento deve pertencer ao ano de referência.';
  end if;

  if new.payroll_run_id is not null then
    select r.organization_id, r.payroll_type,
           extract(year from r.reference_month)::integer
      into v_run_org, v_run_type, v_run_year
    from public.payroll_runs r where r.id = new.payroll_run_id;

    if v_run_org is null or v_run_org <> new.organization_id then
      raise exception 'A folha vinculada não pertence à organização informada.';
    end if;
    if v_run_type <> 'thirteenth_salary' or v_run_year <> new.tax_year then
      raise exception 'A folha vinculada deve ser do tipo 13º salário e do mesmo ano de referência.';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if old.organization_id <> new.organization_id
       or old.employee_id <> new.employee_id
       or old.tax_year <> new.tax_year
       or old.installment <> new.installment
       or old.amount <> new.amount
       or old.payment_date <> new.payment_date
       or old.payroll_run_id is distinct from new.payroll_run_id then
      raise exception 'Dados-base do adiantamento são imutáveis; estorne e registre novo lançamento.';
    end if;
    if old.status = 'reversed' then
      raise exception 'Adiantamento estornado não pode ser reativado.';
    end if;
    if new.status not in ('paid','reversed') then
      raise exception 'Transição de situação não permitida.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.register_payroll_thirteenth_advance(
  p_organization_id uuid,
  p_employee_id uuid,
  p_tax_year integer,
  p_amount numeric,
  p_payment_date date,
  p_payroll_run_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_id uuid;
begin
  if v_user is null then raise exception 'Autenticação necessária.'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'O valor do adiantamento deve ser maior que zero.';
  end if;
  if p_tax_year < 1900 or p_tax_year > 9999 or p_payment_date is null
     or extract(year from p_payment_date)::integer <> p_tax_year then
    raise exception 'Ano e data de pagamento inválidos.';
  end if;

  select m.role into v_role
  from public.organization_memberships m
  where m.organization_id = p_organization_id
    and m.user_id = v_user and m.status = 'active'
  limit 1;

  if v_role is null or v_role not in ('owner','admin','hr_manager','payroll') then
    raise exception 'Perfil sem permissão para registrar adiantamento do 13º.';
  end if;

  insert into public.payroll_thirteenth_advances (
    organization_id, employee_id, tax_year, installment, amount,
    payment_date, payroll_run_id, status, notes, created_by
  ) values (
    p_organization_id, p_employee_id, p_tax_year, 1, round(p_amount,2),
    p_payment_date, p_payroll_run_id, 'planned', nullif(trim(p_notes),''),
    v_user
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.mark_payroll_thirteenth_advance_paid(
  p_advance_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_role text;
begin
  if v_user is null then raise exception 'Autenticação necessária.'; end if;

  select a.organization_id into v_org
  from public.payroll_thirteenth_advances a
  where a.id = p_advance_id
  for update;

  if v_org is null then raise exception 'Adiantamento não encontrado.'; end if;

  select m.role into v_role
  from public.organization_memberships m
  where m.organization_id = v_org
    and m.user_id = v_user and m.status = 'active'
  limit 1;

  if v_role is null or v_role not in ('owner','admin','hr_manager','payroll') then
    raise exception 'Perfil sem permissão para baixar adiantamento do 13º.';
  end if;

  update public.payroll_thirteenth_advances
  set status = 'paid', updated_at = now()
  where id = p_advance_id and status = 'planned';

  if not found then raise exception 'Somente adiantamentos planejados podem ser baixados.'; end if;
end;
$$;

create or replace function public.reverse_payroll_thirteenth_advance(
  p_advance_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_role text;
begin
  if v_user is null then raise exception 'Autenticação necessária.'; end if;
  if nullif(trim(p_reason),'') is null then
    raise exception 'Informe o motivo do estorno.';
  end if;

  select a.organization_id into v_org
  from public.payroll_thirteenth_advances a
  where a.id = p_advance_id
  for update;

  if v_org is null then raise exception 'Adiantamento não encontrado.'; end if;

  select m.role into v_role
  from public.organization_memberships m
  where m.organization_id = v_org
    and m.user_id = v_user and m.status = 'active'
  limit 1;

  if v_role is null or v_role not in ('owner','admin','hr_manager','payroll') then
    raise exception 'Perfil sem permissão para estornar adiantamento do 13º.';
  end if;

  update public.payroll_thirteenth_advances
  set status = 'reversed',
      notes = concat_ws(E'\\n', nullif(notes,''), 'Estorno: ' || trim(p_reason)),
      updated_at = now()
  where id = p_advance_id and status in ('planned','paid');

  if not found then raise exception 'Adiantamento já estornado ou situação inválida.'; end if;
end;
$$;

revoke all on function public.register_payroll_thirteenth_advance(uuid,uuid,integer,numeric,date,uuid,text) from public, anon, authenticated;
revoke all on function public.mark_payroll_thirteenth_advance_paid(uuid) from public, anon, authenticated;
revoke all on function public.reverse_payroll_thirteenth_advance(uuid,text) from public, anon, authenticated;
grant execute on function public.register_payroll_thirteenth_advance(uuid,uuid,integer,numeric,date,uuid,text) to authenticated;
grant execute on function public.mark_payroll_thirteenth_advance_paid(uuid) to authenticated;
grant execute on function public.reverse_payroll_thirteenth_advance(uuid,text) to authenticated;
