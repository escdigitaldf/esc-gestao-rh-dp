create or replace view public.dsr_effective_employee_work_occurrences
with (security_invoker=true) as
select (jsonb_populate_record(o,coalesce(r.proposed_snapshot,to_jsonb(o)))).*
from public.employee_work_occurrences o
left join lateral (
  select x.proposed_snapshot from public.dsr_historical_correction_requests x
  where x.organization_id=o.organization_id and x.target_type='occurrence'
    and x.target_id=o.id and x.status='approved'
  order by x.requested_at desc limit 1
) r on true;

create or replace view public.dsr_effective_employee_work_schedules
with (security_invoker=true) as
select (jsonb_populate_record(s,coalesce(r.proposed_snapshot,to_jsonb(s)))).*
from public.employee_work_schedules s
left join lateral (
  select x.proposed_snapshot from public.dsr_historical_correction_requests x
  where x.organization_id=s.organization_id and x.target_type='schedule'
    and x.target_id=s.id and x.status='approved'
  order by x.requested_at desc limit 1
) r on true;