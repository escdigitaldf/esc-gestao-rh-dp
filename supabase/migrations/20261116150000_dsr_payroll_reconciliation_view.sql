-- Read-only reconciliation between DSR-eligible variable events and payroll postings.
-- It does not calculate DSR, mutate payroll, or release financial processing.
create or replace view public.dsr_payroll_reconciliation
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
      filter (where e.status is not null) as payroll_entry_statuses
  from public.payroll_entry_items i
  join public.payroll_entries e
    on e.id = i.payroll_entry_id
   and e.organization_id = i.organization_id
  join public.payroll_runs r
    on r.id = e.payroll_run_id
   and r.organization_id = e.organization_id
  where i.affects_dsr is true
    and i.payroll_variable_event_id is not null
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
    coalesce(v.amount, v.quantity * v.unit_value, 0)::numeric as event_amount,
    v.status as event_status,
    v.processed_entry_id,
    coalesce(p.payroll_item_count, 0)::integer as payroll_item_count,
    coalesce(p.payroll_item_amount, 0)::numeric as payroll_item_amount,
    p.payroll_competences,
    p.payroll_run_statuses,
    p.payroll_entry_statuses,
    case
      when coalesce(p.payroll_item_count, 0) > 1 then 'duplicate_posting'
      when coalesce(p.payroll_item_count, 0) = 0 and v.status = 'pending' then 'awaiting_approval'
      when coalesce(p.payroll_item_count, 0) = 0 and v.status = 'approved' then 'approved_not_posted'
      when coalesce(p.payroll_item_count, 0) = 0 and v.status = 'processed' then 'processed_without_item'
      when abs(coalesce(p.payroll_item_amount, 0) - coalesce(v.amount, v.quantity * v.unit_value, 0)) > 0.01 then 'amount_mismatch'
      when not (v.competence = any(coalesce(p.payroll_competences, array[]::date[]))) then 'competence_mismatch'
      when v.status <> 'processed' then 'event_status_mismatch'
      else 'reconciled'
    end as reconciliation_status
  from public.payroll_variable_events v
  left join public.employees emp
    on emp.id = v.employee_id and emp.organization_id = v.organization_id
  left join event_postings p
    on p.organization_id = v.organization_id
   and p.payroll_variable_event_id = v.id
  left join public.payroll_entries pe
    on pe.id = v.processed_entry_id and pe.organization_id = v.organization_id
  where v.affects_dsr is true
    and v.status in ('pending', 'approved', 'processed')
),
orphan_items as (
  select
    null::uuid as variable_event_id,
    i.organization_id,
    e.employee_id,
    e.employee_code,
    e.employee_name,
    r.reference_month as competence_month,
    null::date as event_date,
    i.code,
    i.description,
    null::numeric as event_amount,
    null::text as event_status,
    e.id as processed_entry_id,
    1::integer as payroll_item_count,
    i.amount::numeric as payroll_item_amount,
    array[r.reference_month]::date[] as payroll_competences,
    array[r.status]::text[] as payroll_run_statuses,
    array[e.status]::text[] as payroll_entry_statuses,
    'payroll_item_without_event'::text as reconciliation_status
  from public.payroll_entry_items i
  join public.payroll_entries e
    on e.id = i.payroll_entry_id and e.organization_id = i.organization_id
  join public.payroll_runs r
    on r.id = e.payroll_run_id and r.organization_id = e.organization_id
  where i.affects_dsr is true
    and i.payroll_variable_event_id is null
)
select * from event_rows
union all
select * from orphan_items;

comment on view public.dsr_payroll_reconciliation is
'Read-only DSR reconciliation of variable events against payroll entry items. No DSR calculation or payroll mutation.';
grant select on public.dsr_payroll_reconciliation to authenticated;
