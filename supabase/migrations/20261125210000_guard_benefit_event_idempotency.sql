-- Prevent concurrent duplicate generation of benefit payroll events.
-- The existing payroll_variable_event_guard serializes writes by organization and competence.
-- This additional trigger uses the same transaction-scoped lock and protects the source key
-- (assignment + event kind) even when two browser sessions generate events simultaneously.

create or replace function public.guard_esc_benefit_event_idempotency()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.notes is null or new.notes not like 'ESC_BENEFIT:%' then
    return new;
  end if;

  -- Keep the same lock key used by payroll_variable_event_guard.
  perform pg_advisory_xact_lock(
    hashtextextended(new.organization_id::text || ':' || new.competence::text, 0)
  );

  if exists (
    select 1
    from public.payroll_variable_events e
    where e.organization_id = new.organization_id
      and e.competence = new.competence
      and e.notes = new.notes
      and e.status <> 'rejected'
  ) then
    raise exception 'Este evento de benefício já foi gerado para a atribuição e competência informadas.'
      using errcode = '23505';
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_esc_benefit_event_idempotency() from public, anon, authenticated;

drop trigger if exists zz_guard_esc_benefit_event_idempotency on public.payroll_variable_events;
create trigger zz_guard_esc_benefit_event_idempotency
before insert on public.payroll_variable_events
for each row
execute function public.guard_esc_benefit_event_idempotency();

create index if not exists payroll_variable_events_esc_benefit_source_idx
on public.payroll_variable_events (organization_id, competence, notes)
where notes like 'ESC_BENEFIT:%' and status <> 'rejected';
