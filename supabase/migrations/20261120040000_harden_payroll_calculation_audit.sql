-- Endurece a auditoria da folha: distingue rubricas variáveis de itens
-- estatutários gerados pelo motor e compara o snapshot de incidências do evento.
create or replace view public.payroll_calculation_base_audit
with (security_invoker = true)
as
with item_audit as (
  select i.organization_id,i.payroll_entry_id,count(*)::integer as item_count,
    coalesce(sum(i.amount) filter (where lower(i.item_type)='earning'),0)::numeric(14,2) as calculated_gross,
    coalesce(sum(i.amount) filter (where lower(i.item_type)='deduction'),0)::numeric(14,2) as calculated_deductions,
    coalesce(sum(i.amount) filter (where lower(i.item_type)='earning' and i.affects_inss),0)::numeric(14,2) as inss_incident_earnings,
    coalesce(sum(i.amount) filter (where lower(i.item_type)='earning' and i.affects_irrf),0)::numeric(14,2) as irrf_incident_earnings,
    coalesce(sum(i.amount) filter (where lower(i.item_type)='earning' and i.affects_fgts),0)::numeric(14,2) as fgts_incident_earnings,
    count(*) filter (where i.payroll_variable_event_id is not null and i.rubric_id is null)::integer as items_without_rubric,
    count(*) filter (where i.payroll_variable_event_id is not null and i.rubric_id is null and
      (select count(*) from public.payroll_rubrics r where r.organization_id=i.organization_id and r.code=i.code)>1)::integer as items_with_ambiguous_rubric,
    count(*) filter (where i.rubric_id is not null and not exists (
      select 1 from public.payroll_rubrics r where r.id=i.rubric_id and r.organization_id=i.organization_id
        and r.code=i.code and r.item_type is not distinct from i.item_type
        and r.affects_inss is not distinct from i.affects_inss
        and r.affects_irrf is not distinct from i.affects_irrf
        and r.affects_fgts is not distinct from i.affects_fgts
        and r.affects_dsr is not distinct from i.affects_dsr
        and r.affects_employer_inss is not distinct from i.affects_employer_inss
        and r.affects_rat is not distinct from i.affects_rat
        and r.affects_third_parties is not distinct from i.affects_third_parties
        and r.affects_payroll_pis is not distinct from i.affects_payroll_pis
    ))::integer as items_with_rubric_incidence_mismatch,
    count(*) filter (where i.payroll_variable_event_id is not null and exists (
      select 1 from public.payroll_variable_events ev
      where ev.id=i.payroll_variable_event_id and ev.organization_id=i.organization_id
        and (ev.rubric_id is distinct from i.rubric_id or ev.code is distinct from i.code or ev.amount is distinct from i.amount or ev.item_type is distinct from i.item_type
          or ev.affects_inss is distinct from i.affects_inss or ev.affects_irrf is distinct from i.affects_irrf
          or ev.affects_fgts is distinct from i.affects_fgts or ev.affects_dsr is distinct from i.affects_dsr
          or ev.affects_employer_inss is distinct from i.affects_employer_inss
          or ev.affects_rat is distinct from i.affects_rat
          or ev.affects_third_parties is distinct from i.affects_third_parties
          or ev.affects_payroll_pis is distinct from i.affects_payroll_pis)
    ))::integer as items_with_event_incidence_mismatch,
    coalesce(sum(i.amount) filter (where lower(i.item_type)='earning' and i.affects_employer_inss),0)::numeric(14,2) as employer_inss_incident_earnings,
    coalesce(sum(i.amount) filter (where lower(i.item_type)='earning' and i.affects_rat),0)::numeric(14,2) as rat_incident_earnings,
    coalesce(sum(i.amount) filter (where lower(i.item_type)='earning' and i.affects_third_parties),0)::numeric(14,2) as third_parties_incident_earnings,
    coalesce(sum(i.amount) filter (where lower(i.item_type)='earning' and i.affects_payroll_pis),0)::numeric(14,2) as payroll_pis_incident_earnings,
    coalesce(sum(i.amount) filter (where lower(i.item_type)='employer_charge'),0)::numeric(14,2) as employer_charges_total
  from public.payroll_entry_items i group by i.organization_id,i.payroll_entry_id
),
run_totals as (
  select e.organization_id,e.payroll_run_id,count(*)::integer as calculated_employee_count,
    coalesce(sum(e.gross_amount),0)::numeric(14,2) as entries_gross_total,
    coalesce(sum(e.deductions_amount),0)::numeric(14,2) as entries_deductions_total,
    coalesce(sum(e.net_amount),0)::numeric(14,2) as entries_net_total
  from public.payroll_entries e group by e.organization_id,e.payroll_run_id
)
select
  r.organization_id,r.id as payroll_run_id,r.reference_month as competence,r.status as payroll_run_status,
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
  r.tax_parameters_snapshot,r.tax_year,
  coalesce(ia.employer_inss_incident_earnings,0)::numeric(14,2) as employer_inss_incident_earnings,
  coalesce(ia.rat_incident_earnings,0)::numeric(14,2) as rat_incident_earnings,
  coalesce(ia.third_parties_incident_earnings,0)::numeric(14,2) as third_parties_incident_earnings,
  coalesce(ia.payroll_pis_incident_earnings,0)::numeric(14,2) as payroll_pis_incident_earnings,
  coalesce(ia.employer_charges_total,0)::numeric(14,2) as employer_charges_total,
  coalesce(ia.items_with_event_incidence_mismatch,0)::integer as items_with_event_incidence_mismatch,
  (r.employee_count is distinct from rt.calculated_employee_count) as run_employee_count_mismatch
from public.payroll_runs r
join public.payroll_entries e on e.payroll_run_id=r.id and e.organization_id=r.organization_id
left join item_audit ia on ia.payroll_entry_id=e.id and ia.organization_id=e.organization_id
left join run_totals rt on rt.payroll_run_id=e.payroll_run_id and rt.organization_id=e.organization_id;

create or replace view public.payroll_calculation_run_audit
with (security_invoker = true)
as
select r.organization_id,r.id as payroll_run_id,r.reference_month as competence,r.status as payroll_run_status,
  r.employee_count as stored_employee_count,count(e.id)::integer as calculated_employee_count,
  r.total_earnings as stored_gross,coalesce(sum(e.gross_amount),0)::numeric(14,2) as calculated_gross,
  r.total_deductions as stored_deductions,coalesce(sum(e.deductions_amount),0)::numeric(14,2) as calculated_deductions,
  r.total_net as stored_net,coalesce(sum(e.net_amount),0)::numeric(14,2) as calculated_net,
  (r.employee_count is distinct from count(e.id)::integer) as employee_count_mismatch,
  (abs(r.total_earnings-coalesce(sum(e.gross_amount),0))>0.01) as gross_mismatch,
  (abs(r.total_deductions-coalesce(sum(e.deductions_amount),0))>0.01) as deductions_mismatch,
  (abs(r.total_net-coalesce(sum(e.net_amount),0))>0.01) as net_mismatch,
from public.payroll_runs r
left join public.payroll_entries e on e.payroll_run_id=r.id and e.organization_id=r.organization_id
group by r.organization_id,r.id,r.reference_month,r.status,r.employee_count,r.total_earnings,r.total_deductions,r.total_net;

grant select on public.payroll_calculation_base_audit to authenticated;
grant select on public.payroll_calculation_run_audit to authenticated;
