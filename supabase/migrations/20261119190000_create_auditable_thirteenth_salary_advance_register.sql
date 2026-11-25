-- Auditable register for the first 13th-salary installment.
-- Writes remain disabled for client roles until the controlled payroll workflow is implemented.

create table public.payroll_thirteenth_advances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  tax_year integer not null check (tax_year between 1900 and 9999),
  installment smallint not null default 1 check (installment = 1),
  amount numeric(14,2) not null check (amount > 0),
  payment_date date not null,
  payroll_run_id uuid references public.payroll_runs(id) on delete set null,
  status text not null default 'planned'
    check (status in ('planned','paid','reversed')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_thirteenth_advances_employee_year_installment_key
    unique (organization_id, employee_id, tax_year, installment)
);

create index payroll_thirteenth_advances_org_year_idx
  on public.payroll_thirteenth_advances (organization_id, tax_year, status);

create index payroll_thirteenth_advances_run_idx
  on public.payroll_thirteenth_advances (payroll_run_id)
  where payroll_run_id is not null;

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
       or old.installment <> new.installment then
      raise exception 'A identidade do adiantamento é imutável; registre estorno e novo lançamento.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_payroll_thirteenth_advance() from public, anon, authenticated;

create trigger validate_payroll_thirteenth_advance_before_write
before insert or update on public.payroll_thirteenth_advances
for each row execute function public.validate_payroll_thirteenth_advance();

alter table public.payroll_thirteenth_advances enable row level security;

create policy "payroll_thirteenth_advances_read_authorized_members"
on public.payroll_thirteenth_advances
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = payroll_thirteenth_advances.organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role in ('owner','admin','hr_manager','payroll')
  )
);

revoke all on table public.payroll_thirteenth_advances from anon, authenticated;
grant select on table public.payroll_thirteenth_advances to authenticated;
