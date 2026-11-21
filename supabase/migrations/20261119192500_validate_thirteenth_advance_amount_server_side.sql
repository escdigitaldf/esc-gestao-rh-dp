-- Recompute and validate the 1st installment on the server.
-- Prevents a client from submitting an arbitrary advance amount.

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
  v_admission date;
  v_termination date;
  v_employment_type text;
  v_employment_status text;
  v_payment_salary_count integer;
  v_december_salary_count integer;
  v_payment_salary numeric;
  v_december_salary numeric;
  v_salary_type text;
  v_december_salary_type text;
  v_eligible_months integer;
  v_expected_amount numeric(14,2);
begin
  if v_user is null then raise exception 'Autenticação necessária.'; end if;
  if p_tax_year < 1900 or p_tax_year > 9999 or p_payment_date is null
     or extract(year from p_payment_date)::integer <> p_tax_year
     or p_payment_date > make_date(p_tax_year,11,30) then
    raise exception 'Data de pagamento da primeira parcela inválida; deve ocorrer até 30/11 do ano de referência.';
  end if;

  select m.role into v_role
  from public.organization_memberships m
  where m.organization_id = p_organization_id
    and m.user_id = v_user and m.status = 'active'
  limit 1;

  if v_role is null or v_role not in ('owner','admin','hr_manager','payroll') then
    raise exception 'Perfil sem permissão para registrar adiantamento do 13º.';
  end if;

  select e.admission_date,e.termination_date,e.employment_type,e.employment_status
    into v_admission,v_termination,v_employment_type,v_employment_status
  from public.employees e
  where e.id=p_employee_id and e.organization_id=p_organization_id;

  if not found then raise exception 'Colaborador não pertence à organização informada.'; end if;
  if v_employment_status <> 'active' or v_employment_type not in ('CLT','Aprendiz') then
    raise exception 'Somente vínculos CLT/Aprendiz ativos podem receber adiantamento anual nesta rotina.';
  end if;
  if v_admission is null then raise exception 'Data de admissão não cadastrada.'; end if;

  select count(*)::integer,
         max(h.salary_amount) filter (where h.effective_from <= p_payment_date and coalesce(h.effective_to,'infinity'::date) >= p_payment_date),
         max(h.salary_type) filter (where h.effective_from <= p_payment_date and coalesce(h.effective_to,'infinity'::date) >= p_payment_date)
    into v_payment_salary_count,v_payment_salary,v_salary_type
  from public.employee_salary_history h
  where h.organization_id=p_organization_id and h.employee_id=p_employee_id
    and h.effective_from <= p_payment_date and coalesce(h.effective_to,'infinity'::date) >= p_payment_date;

  select count(*)::integer,
         max(h.salary_amount) filter (where h.effective_from <= make_date(p_tax_year,12,31) and coalesce(h.effective_to,'infinity'::date) >= make_date(p_tax_year,12,31)),
         max(h.salary_type) filter (where h.effective_from <= make_date(p_tax_year,12,31) and coalesce(h.effective_to,'infinity'::date) >= make_date(p_tax_year,12,31))
    into v_december_salary_count,v_december_salary,v_december_salary_type
  from public.employee_salary_history h
  where h.organization_id=p_organization_id and h.employee_id=p_employee_id
    and h.effective_from <= make_date(p_tax_year,12,31)
    and coalesce(h.effective_to,'infinity'::date) >= make_date(p_tax_year,12,31);

  if v_payment_salary_count <> 1 or v_december_salary_count <> 1 then
    raise exception 'Histórico salarial deve cobrir de forma única a data do pagamento e 31/12.';
  end if;
  if lower(coalesce(v_salary_type,'')) not in ('monthly','mensal')
     or lower(coalesce(v_december_salary_type,'')) not in ('monthly','mensal') then
    raise exception 'Remuneração não mensal exige cálculo manual.';
  end if;
  if v_payment_salary is null or v_payment_salary <= 0
     or v_december_salary is null or v_december_salary <= 0
     or v_payment_salary <> v_december_salary then
    raise exception 'Alteração salarial entre a data do pagamento e 31/12 exige revisão manual.';
  end if;

  select c.eligible_months into v_eligible_months
  from public.calculate_fixed_monthly_thirteenth(
    v_december_salary,v_admission,v_termination,p_tax_year
  ) c;

  v_expected_amount := round(v_payment_salary * v_eligible_months / 12 * 0.5,2);
  if v_expected_amount <= 0 or round(p_amount,2) <> v_expected_amount then
    raise exception 'Valor informado diverge da prévia validada da primeira parcela. Recarregue a apuração.';
  end if;

  insert into public.payroll_thirteenth_advances (
    organization_id, employee_id, tax_year, installment, amount,
    payment_date, payroll_run_id, status, notes, created_by
  ) values (
    p_organization_id, p_employee_id, p_tax_year, 1, v_expected_amount,
    p_payment_date, p_payroll_run_id, 'planned', nullif(trim(p_notes),''),
    v_user
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.register_payroll_thirteenth_advance(uuid,uuid,integer,numeric,date,uuid,text) from public, anon, authenticated;
grant execute on function public.register_payroll_thirteenth_advance(uuid,uuid,integer,numeric,date,uuid,text) to authenticated;
