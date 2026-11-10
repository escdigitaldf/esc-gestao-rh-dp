-- A payroll competence cannot be created while variable events are undecided.
create or replace function public.guard_payroll_run_pending_variable_events()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text || ':' || new.reference_month::text, 0));
  if exists (
    select 1 from public.payroll_variable_events e
    where e.organization_id = new.organization_id
      and e.competence = new.reference_month
      and e.status = 'pending'
  ) then
    raise exception 'Há eventos variáveis pendentes de decisão nesta competência. Aprove ou rejeite todos antes de gerar a folha.';
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_payroll_run_pending_variable_events() from public, anon, authenticated;
drop trigger if exists payroll_run_check_pending_variable_events on public.payroll_runs;
create trigger payroll_run_check_pending_variable_events
before insert on public.payroll_runs
for each row execute function public.guard_payroll_run_pending_variable_events();
