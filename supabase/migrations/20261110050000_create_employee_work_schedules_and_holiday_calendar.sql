-- DSR foundation: employee-specific schedules and organization holiday calendar.
-- DSR calculation remains blocked until the applicable collective/legal rule is validated.
create extension if not exists btree_gist;

create table if not exists public.employee_work_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  schedule_name text not null,
  schedule_type text not null check (schedule_type in ('fixed_weekly','rotating','twelve_by_thirty_six','custom')),
  effective_from date not null,
  effective_to date,
  work_days smallint[] not null default '{}'::smallint[],
  weekly_rest_days smallint[] not null default '{}'::smallint[],
  weekly_hours numeric(7,2),
  cycle_days integer,
  cycle_pattern jsonb not null default '[]'::jsonb,
  dsr_rule_status text not null default 'pending_validation' check (dsr_rule_status in ('pending_validation','validated','suspended')),
  dsr_rule_notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_work_schedules_dates_chk check (effective_to is null or effective_to >= effective_from),
  constraint employee_work_schedules_weekly_hours_chk check (weekly_hours is null or weekly_hours > 0),
  constraint employee_work_schedules_cycle_days_chk check (cycle_days is null or cycle_days > 0),
  constraint employee_work_schedules_work_days_chk check (work_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  constraint employee_work_schedules_rest_days_chk check (weekly_rest_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  constraint employee_work_schedules_cycle_pattern_chk check (jsonb_typeof(cycle_pattern) = 'array')
);
create index if not exists employee_work_schedules_org_employee_dates_idx on public.employee_work_schedules (organization_id, employee_id, effective_from, effective_to);

create table if not exists public.organization_holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  holiday_date date not null,
  name text not null,
  holiday_scope text not null check (holiday_scope in ('national','state','municipal','organization')),
  state_code text,
  city text,
  is_optional_workday boolean not null default false,
  legal_reference text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_holidays_state_chk check (state_code is null or char_length(state_code) = 2),
  constraint organization_holidays_scope_location_chk check (
    (holiday_scope not in ('state','municipal') or state_code is not null)
    and (holiday_scope <> 'municipal' or city is not null)
  ),
  unique (organization_id, holiday_date, name)
);
create index if not exists organization_holidays_org_date_idx on public.organization_holidays (organization_id, holiday_date);

create or replace function public.guard_employee_work_schedule()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if not exists (select 1 from public.employees e where e.id = new.employee_id and e.organization_id = new.organization_id) then
    raise exception 'O colaborador informado não pertence à organização da escala.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text || ':' || new.employee_id::text, 0));
  if exists (
    select 1 from public.employee_work_schedules s
    where s.organization_id = new.organization_id and s.employee_id = new.employee_id
      and s.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and daterange(s.effective_from, coalesce(s.effective_to + 1, 'infinity'::date), '[)')
          && daterange(new.effective_from, coalesce(new.effective_to + 1, 'infinity'::date), '[)')
  ) then
    raise exception 'Já existe uma escala vigente ou sobreposta para este colaborador no período informado.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_guard_employee_work_schedule on public.employee_work_schedules;
create trigger trg_guard_employee_work_schedule before insert or update on public.employee_work_schedules for each row execute function public.guard_employee_work_schedule();

alter table public.employee_work_schedules enable row level security;
alter table public.organization_holidays enable row level security;
drop policy if exists employee_work_schedules_hr_access on public.employee_work_schedules;
create policy employee_work_schedules_hr_access on public.employee_work_schedules for all to authenticated
using (exists (select 1 from public.organization_memberships m where m.organization_id = employee_work_schedules.organization_id and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = any(array['owner','admin','hr_manager','payroll'])))
with check (exists (select 1 from public.organization_memberships m where m.organization_id = employee_work_schedules.organization_id and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = any(array['owner','admin','hr_manager','payroll'])));
drop policy if exists organization_holidays_hr_access on public.organization_holidays;
create policy organization_holidays_hr_access on public.organization_holidays for all to authenticated
using (exists (select 1 from public.organization_memberships m where m.organization_id = organization_holidays.organization_id and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = any(array['owner','admin','hr_manager','payroll'])))
with check (exists (select 1 from public.organization_memberships m where m.organization_id = organization_holidays.organization_id and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = any(array['owner','admin','hr_manager','payroll'])));
grant select, insert, update, delete on public.employee_work_schedules to authenticated;
grant select, insert, update, delete on public.organization_holidays to authenticated;
