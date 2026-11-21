create or replace view public.payroll_variable_event_reconciliation
with (security_invoker = true)
as
with event_postings as (
  select
    i.organization_id,
    i.payroll_variable_event_id,
    count(*)::integer as payroll_item_count,
    coalesce(sum(i.amount), 0)::numeric as payroll_item_amount,
    array_agg(distinct r.reference_month order by r.reference_month)
      filter (where r.reference_month is not null) as payroll_competences,
    array_agg(distinct r.status order by r.status)
      filter (where r.status is not null) as payroll_run_statuses,
    array_agg(distinct e.status order by e.status)
      filter (where e.status is not null) as payroll_entry_statuses,
    array_agg(distinct e.id) as payroll_entry_ids,
    bool_or(i.affects_inss is distinct from v.affects_inss) as item_inss_mismatch,
    bool_or(i.affects_irrf is distinct from v.affects_irrf) as item_irrf_mismatch,
    bool_or(i.affects_fgts is distinct from v.affects_fgts) as item_fgts_mismatch,
    bool_or(i.affects_dsr is distinct from v.affects_dsr) as item_dsr_mismatch
  from public.payroll_entry_items i
  join public.payroll_variable_events v
    on v.id = i.payroll_variable_event_id
   and v.organization_id = i.organization_id
  join public.payroll_entries e
    on e.id = i.payroll_entry_id
   and e.organization_id = i.organization_id
  join public.payroll_runs r
    on r.id = e.payroll_run_id
   and r.organization_id = e.organization_id
  group by i.organization_id, i.payroll_variable_event_id
),
event_rows as (
  select
    v.id as variable_event_id,
    v.organization_id,
    v.employee_id,
    coalesce(emp.employee_code, pe.employee_code) as employee_code,
    coalesce(emp.full_name, pe.employee_name) as employee_name,
    v.competence as competence_month,
    v.event_date,
    v.code,
    v.description,
    v.item_type,
    v.quantity,
    v.quantity_unit,
    v.unit_value,
    coalesce(v.amount, v.quantity * v.unit_value, 0)::numeric as event_amount,
    v.status as event_status,
    v.processed_entry_id,
    v.affects_inss as event_affects_inss,
    v.affects_irrf as event_affects_irrf,
    v.affects_fgts as event_affects_fgts,
    v.affects_dsr as event_affects_dsr,
    rb.id as rubric_id,
    rb.active as rubric_active,
    rb.item_type as rubric_item_type,
    rb.affects_inss as rubric_affects_inss,
    rb.affects_irrf as rubric_affects_irrf,
    rb.affects_fgts as rubric_affects_fgts,
    rb.affects_dsr as rubric_affects_dsr,
    coalesce(p.payroll_item_count, 0) as payroll_item_count,
    coalesce(p.payroll_item_amount, 0)::numeric as payroll_item_amount,
    p.payroll_competences,
    p.payroll_run_statuses,
    p.payroll_entry_statuses,
    p.payroll_entry_ids,
    coalesce(p.item_inss_mismatch, false) as item_inss_mismatch,
    coalesce(p.item_irrf_mismatch, false) as item_irrf_mismatch,
    coalesce(p.item_fgts_mismatch, false) as item_fgts_mismatch,
    coalesce(p.item_dsr_mismatch, false) as item_dsr_mismatch,
    (
      v.affects_inss is distinct from rb.affects_inss
      or v.affects_irrf is distinct from rb.affects_irrf
      or v.affects_fgts is distinct from rb.affects_fgts
      or v.affects_dsr is distinct from rb.affects_dsr
    ) as rubric_incidence_mismatch,
    case
      when coalesce(p.payroll_item_count, 0) > 1 then 'duplicate_posting'
      when v.status = 'rejected' and coalesce(p.payroll_item_count, 0) > 0 then 'rejected_event_posted'
      when v.rubric_id is null or rb.id is null then 'event_without_rubric'
      when rb.active is not true then 'inactive_rubric'
      when v.item_type is distinct from rb.item_type then 'rubric_type_mismatch'
      when (
        v.affects_inss is distinct from rb.affects_inss
        or v.affects_irrf is distinct from rb.affects_irrf
        or v.affects_fgts is distinct from rb.affects_fgts
        or v.affects_dsr is distinct from rb.affects_dsr
      ) then 'rubric_incidence_mismatch'
      when coalesce(p.payroll_item_count, 0) = 0 and v.status = 'pending' then 'awaiting_approval'
      when coalesce(p.payroll_item_count, 0) = 0 and v.status = 'approved' then 'approved_not_posted'
      when coalesce(p.payroll_item_count, 0) = 0 and v.status = 'processed' then 'processed_without_item'
      when coalesce(p.payroll_item_count, 0) = 0 then 'not_posted'
      when abs(coalesce(p.payroll_item_amount, 0) - coalesce(v.amount, v.quantity * v.unit_value, 0)) > 0.01 then 'amount_mismatch'
      when not (v.competence = any(coalesce(p.payroll_competences, array[]::date[]))) then 'competence_mismatch'
      when p.item_inss_mismatch or p.item_irrf_mismatch or p.item_fgts_mismatch or p.item_dsr_mismatch then 'incidence_mismatch'
      when v.status = 'processed' and (
        v.processed_entry_id is null
        or not (v.processed_entry_id = any(coalesce(p.payroll_entry_ids, array[]::uuid[])))
      ) then 'entry_reference_mismatch'
      when v.status <> 'processed' then 'event_status_mismatch'
      else 'reconciled'
    end as reconciliation_status
  from public.payroll_variable_events v
  left join public.employees emp
    on emp.id = v.employee_id and emp.organization_id = v.organization_id
  left join public.payroll_rubrics rb
    on rb.id = v.rubric_id and rb.organization_id = v.organization_id
  left join event_postings p
    on p.organization_id = v.organization_id and p.payroll_variable_event_id = v.id
  left join public.payroll_entries pe
    on pe.id = v.processed_entry_id and pe.organization_id = v.organization_id
)
select * from event_rows;

grant select on public.payroll_variable_event_reconciliation to authenticated;
