alter table public.payroll_variable_events
  add column if not exists quantity_unit text not null default 'units';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payroll_variable_events_quantity_unit_check'
      and conrelid = 'public.payroll_variable_events'::regclass
  ) then
    alter table public.payroll_variable_events
      add constraint payroll_variable_events_quantity_unit_check
      check (quantity_unit in ('hours', 'days', 'units')) not valid;
  end if;
end
$$;

alter table public.payroll_variable_events
  validate constraint payroll_variable_events_quantity_unit_check;
