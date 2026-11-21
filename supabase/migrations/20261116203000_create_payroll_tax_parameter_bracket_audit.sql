create or replace view public.payroll_tax_parameter_bracket_audit
with (security_invoker = true)
as
select null::uuid as organization_id,'legal'::text as table_scope,t.id as table_id,t.tax_code as table_code,
  b.id as bracket_id,b.bracket_order,b.lower_limit,b.upper_limit,b.rate,
  (b.rate*100)::numeric(12,6) as displayed_rate,b.deduction as deduction_amount,0::numeric as fixed_amount
from public.payroll_tax_tables t join public.payroll_tax_brackets b on b.tax_table_id=t.id
union all
select p.organization_id,'organization'::text,p.id,p.table_code,b.id,b.bracket_order,b.lower_limit,
  b.upper_limit,b.rate,b.rate::numeric(12,6),b.deduction_amount,b.fixed_amount
from public.payroll_parameter_tables p join public.payroll_parameter_brackets b
  on b.parameter_table_id=p.id and b.organization_id=p.organization_id;
grant select on public.payroll_tax_parameter_bracket_audit to authenticated;