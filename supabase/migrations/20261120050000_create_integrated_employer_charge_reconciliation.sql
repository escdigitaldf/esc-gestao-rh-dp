-- Integrated employer-charge reconciliation at employee level.
-- The processed payroll currently exposes a consolidated employer-charge item total,
-- not a validated per-contribution code map. Keep that total separate and never
-- allocate it across CPP/RAT/third parties/PIS by assumption.
create or replace view public.payroll_employer_charge_employee_reconciliation
with (security_invoker = true)
as
select
  p.organization_id,
  p.id as preview_id,
  p.payroll_run_id,
  p.competence,
  p.status as preview_status,
  p.calculation_version,
  s.item->>'payroll_entry_id' as payroll_entry_id,
  s.item->>'employee_id' as employee_id,
  s.item->>'employee_code' as employee_code,
  s.item->>'employee_name' as employee_name,
  coalesce(nullif(btrim(s.item->>'cost_center'), ''), 'Não informado') as cost_center,
  s.item->>'status' as preview_employee_status,
  s.item->>'issue' as blocking_issue,
  coalesce(nullif(s.item->'amounts'->>'employer_inss','')::numeric,0)::numeric(14,2) as preview_employer_inss,
  coalesce(nullif(s.item->'amounts'->>'rat','')::numeric,0)::numeric(14,2) as preview_rat,
  coalesce(nullif(s.item->'amounts'->>'third_parties','')::numeric,0)::numeric(14,2) as preview_third_parties,
  coalesce(nullif(s.item->'amounts'->>'payroll_pis','')::numeric,0)::numeric(14,2) as preview_payroll_pis,
  (
    coalesce(nullif(s.item->'amounts'->>'employer_inss','')::numeric,0) +
    coalesce(nullif(s.item->'amounts'->>'rat','')::numeric,0) +
    coalesce(nullif(s.item->'amounts'->>'third_parties','')::numeric,0) +
    coalesce(nullif(s.item->'amounts'->>'payroll_pis','')::numeric,0)
  )::numeric(14,2) as preview_total,
  coalesce(a.employer_charges_total,0)::numeric(14,2) as processed_employer_charges_total,
  case
    when a.payroll_entry_id is null then 'audit_unavailable'
    when coalesce(a.employer_charges_total,0)=0 then 'no_employer_charge_item'
    else 'consolidated_only'
  end as processed_amount_status,
  case when a.payroll_entry_id is null then null
       else round(
         coalesce(a.employer_charges_total,0) -
         (
           coalesce(nullif(s.item->'amounts'->>'employer_inss','')::numeric,0) +
           coalesce(nullif(s.item->'amounts'->>'rat','')::numeric,0) +
           coalesce(nullif(s.item->'amounts'->>'third_parties','')::numeric,0) +
           coalesce(nullif(s.item->'amounts'->>'payroll_pis','')::numeric,0)
         ),2)
  end as indicative_total_difference
from public.payroll_employer_charge_previews p
cross join lateral jsonb_array_elements(p.snapshot) as s(item)
left join public.payroll_calculation_base_audit a
  on a.organization_id=p.organization_id
 and a.payroll_run_id=p.payroll_run_id
 and a.payroll_entry_id::text=s.item->>'payroll_entry_id';

grant select on public.payroll_employer_charge_employee_reconciliation to authenticated;

comment on view public.payroll_employer_charge_employee_reconciliation is
'Conciliação por colaborador entre prévia patronal e total consolidado de encargos gravado na folha. O total processado não é distribuído por contribuição, pois o código individual de CPP/RAT/terceiros/PIS não foi validado.';
