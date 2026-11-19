-- A reversal must preserve the audit trail without permanently blocking a corrected replacement.
-- Keep at most one non-reversed first-installment advance per employee and tax year.
alter table public.payroll_thirteenth_advances
  drop constraint if exists payroll_thirteenth_advances_employee_year_installment_key;

create unique index if not exists payroll_thirteenth_advances_one_active_per_employee_year_idx
  on public.payroll_thirteenth_advances (organization_id, employee_id, tax_year, installment)
  where status <> 'reversed';

comment on index public.payroll_thirteenth_advances_one_active_per_employee_year_idx is
  'Permite novo adiantamento após estorno, preservando o histórico e impedindo dois adiantamentos ativos para o mesmo colaborador/ano/parcela.';
