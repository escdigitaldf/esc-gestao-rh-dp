-- Auditoria somente leitura da composição dos lançamentos e totais da folha.
create or replace view public.payroll_calculation_base_audit
with (security_invoker = true)
as
with item_audit as (
  select i.organization_id, i.payroll_entry_id,
    count(*)::integer as item_count,
    coalesce(sum(i.amount) filter (where lower(i.item_type)='earning'),0)::numeric(14,2) as calculated_gross,
    coalesce(sum(i.amount) filter (where lower(i.item_type)='deduction'),0)::numeric(14,2) as calculated_deductions,
    coalesce(sum(i.amount) filter (where lower(i.item_type)='earning' and i.affects_inss),0)::numeric(14,2) as inss_incident_earnings,
    coalesce(sum(i.amount) filter (where lower(i.item_type)='earning' and i.affects_irrf),0)::numeric(14,2) as irrf_incident_earnings,
    coalesce(sum(i.amount) filter (where lower(i.item_type)='earning' and i.affects_fgts),0)::numeric(14,2) as fgts_incident_earnings,
    count(*) filter (where (select count(*) from public.payroll_rubrics r where r.organization_id=i.organization_id and r.code=i.code)=0)::integer as items_without_rubric,
    count(*) filter (where (select count(*) from public.payroll_rubrics r where r.organization_id=i.organization_id and r.code=i.code)>1)::integer as items_with_ambiguous_rubric,
    count(*) filter (where exists (select 1 from public.payroll_rubrics r where r.organization_id=i.organization_id and r.code=i.code and
      (r.item_type is distinct from i.item_type or r.affects_inss is distinct from i.affects_inss or r.affects_irrf is distinct from i.affects_irrf or r.affects_fgts is distinct from i.affects_fgts)))::integer as items_with_rubric_incidence_mismatch
  from public.payroll_entry_items i group by i.organization_id,i.payroll_entry_id
),
run_totals as (
  select e.organization_id,e.payroll_run_id,count(*)::integer as calculated_employee_count,
    coalesce(sum(e.gross_amount),0)::numeric(14,2) as entries_gross_total,
    coalesce(sum(e.deductions_amount),0)::numeric(14,2) as entries_deductions_total,
    coalesce(sum(e.net_amount),0)::numeric(14,2) as entries_net_total
  from public.payroll_entries e group by e.organization_id,e.payroll_run_id
)
select r.organization_id,r.id as payroll_run_id,r.reference_month as competence,r.status as payroll_run_status,
  r.employee_count as stored_employee_count,rt.calculated_employee_count,
  r.total_earnings as stored_run_gross,rt.entries_gross_total as calculated_run_gross,
  r.total_deductions as stored_run_deductions,rt.entries_deductions_total as calculated_run_deductions,
  r.total_net as stored_run_net,rt.entries_net_total as calculated_run_net,
  e.id as payroll_entry_id,e.employee_id,e.employee_code,e.employee_name,e.status as payroll_entry_status,e.salary_base,
  e.gross_amount as stored_gross,coalesce(ia.calculated_gross,0)::numeric(14,2) as calculated_gross,
  e.deductions_amount as stored_deductions,coalesce(ia.calculated_deductions,0)::numeric(14,2) as calculated_deductions,
  e.net_amount as stored_net,(coalesce(ia.calculated_gross,0)-coalesce(ia.calculated_deductions,0))::numeric(14,2) as calculated_net,
  coalesce(ia.item_count,0)::integer as item_count,
  coalesce(ia.inss_incident_earnings,0)::numeric(14,2) as inss_incident_earnings,
  coalesce(ia.irrf_incident_earnings,0)::numeric(14,2) as irrf_incident_earnings,
  coalesce(ia.fgts_incident_earnings,0)::numeric(14,2) as fgts_incident_earnings,
  coalesce(ia.items_without_rubric,0)::integer as items_without_rubric,
  coalesce(ia.items_with_ambiguous_rubric,0)::integer as items_with_ambiguous_rubric,
  coalesce(ia.items_with_rubric_incidence_mismatch,0)::integer as items_with_rubric_incidence_mismatch,
  abs(e.gross_amount-coalesce(ia.calculated_gross,0))>0.01 as gross_mismatch,
  abs(e.deductions_amount-coalesce(ia.calculated_deductions,0))>0.01 as deductions_mismatch,
  abs(e.net_amount-(coalesce(ia.calculated_gross,0)-coalesce(ia.calculated_deductions,0)))>0.01 as net_mismatch,
  abs(r.total_earnings-coalesce(rt.entries_gross_total,0))>0.01 as run_gross_mismatch,
  abs(r.total_deductions-coalesce(rt.entries_deductions_total,0))>0.01 as run_deductions_mismatch,
  abs(r.total_net-coalesce(rt.entries_net_total,0))>0.01 as run_net_mismatch,
  r.tax_parameters_snapshot,r.tax_year
from public.payroll_runs r
join public.payroll_entries e on e.payroll_run_id=r.id and e.organization_id=r.organization_id
left join item_audit ia on ia.payroll_entry_id=e.id and ia.organization_id=e.organization_id
left join run_totals rt on rt.payroll_run_id=r.id and rt.organization_id=r.organization_id;
grant select on public.payroll_calculation_base_audit to authenticated;