create table if not exists public.employee_work_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_schedule_id uuid not null references public.employee_work_schedules(id) on delete restrict,
  occurrence_date date not null,
  occurrence_type text not null check (occurrence_type in ('workday','weekly_rest','holiday','compensatory_rest','absence_justified','absence_unjustified','leave','vacation','other')),
  scheduled_hours numeric(6,2) not null default 0 check (scheduled_hours >= 0 and scheduled_hours <= 24),
  worked_hours numeric(6,2) not null default 0 check (worked_hours >= 0 and worked_hours <= 24),
  holiday_id uuid references public.organization_holidays(id) on delete set null,
  notes text,
  record_status text not null default 'draft' check (record_status in ('draft','validated','rejected')),
  validated_by uuid references auth.users(id) on delete set null,
  validated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_work_occurrences_hours_type_chk check (occurrence_type in ('workday','other') or worked_hours = 0)
);
create unique index if not exists employee_work_occurrences_employee_date_uidx on public.employee_work_occurrences (organization_id, employee_id, occurrence_date);
create index if not exists employee_work_occurrences_org_date_idx on public.employee_work_occurrences (organization_id, occurrence_date);
create index if not exists employee_work_occurrences_schedule_date_idx on public.employee_work_occurrences (work_schedule_id, occurrence_date);

create or replace function public.guard_employee_work_occurrence()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare v_run_status text;
begin
  if tg_op = 'DELETE' then
    perform pg_advisory_xact_lock(hashtextextended(old.organization_id::text || ':' || to_char(old.occurrence_date,'YYYY-MM'), 0));
    select r.status into v_run_status from public.payroll_runs r
    where r.organization_id = old.organization_id and r.reference_month = date_trunc('month', old.occurrence_date)::date and r.status = 'closed' limit 1;
    if v_run_status is not null then raise exception 'Não é permitido excluir ocorrência de competência com folha fechada.'; end if;
    return old;
  end if;
  if not exists (select 1 from public.employees e where e.id = new.employee_id and e.organization_id = new.organization_id) then
    raise exception 'O colaborador não pertence à organização informada.';
  end if;
  if not exists (select 1 from public.employee_work_schedules s where s.id = new.work_schedule_id and s.organization_id = new.organization_id and s.employee_id = new.employee_id and s.effective_from <= new.occurrence_date and (s.effective_to is null or s.effective_to >= new.occurrence_date)) then
    raise exception 'Não existe escala vigente para o colaborador na data da ocorrência.';
  end if;
  if new.holiday_id is not null and not exists (select 1 from public.organization_holidays h where h.id = new.holiday_id and h.organization_id = new.organization_id and h.holiday_date = new.occurrence_date) then
    raise exception 'O feriado selecionado não corresponde à data e organização da ocorrência.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text || ':' || to_char(new.occurrence_date,'YYYY-MM'), 0));
  select r.status into v_run_status from public.payroll_runs r
  where r.organization_id = new.organization_id and r.reference_month = date_trunc('month', new.occurrence_date)::date and r.status = 'closed' limit 1;
  if v_run_status is not null then raise exception 'Não é permitido alterar ocorrência de competência com folha fechada.'; end if;
  if tg_op = 'INSERT' then
    if new.record_status = 'validated' then new.validated_by := (select auth.uid()); new.validated_at := now(); end if;
  elsif new.record_status = 'validated' and old.record_status is distinct from 'validated' then
    new.validated_by := (select auth.uid()); new.validated_at := now();
  elsif new.record_status <> 'validated' then
    new.validated_by := null; new.validated_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_guard_employee_work_occurrence on public.employee_work_occurrences;
create trigger trg_guard_employee_work_occurrence before insert or update or delete on public.employee_work_occurrences for each row execute function public.guard_employee_work_occurrence();
alter table public.employee_work_occurrences enable row level security;
drop policy if exists employee_work_occurrences_hr_access on public.employee_work_occurrences;
create policy employee_work_occurrences_hr_access on public.employee_work_occurrences for all to authenticated
using (exists (select 1 from public.organization_memberships m where m.organization_id = employee_work_occurrences.organization_id and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = any(array['owner','admin','hr_manager','payroll'])))
with check (exists (select 1 from public.organization_memberships m where m.organization_id = employee_work_occurrences.organization_id and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = any(array['owner','admin','hr_manager','payroll'])));
grant select, insert, update, delete on public.employee_work_occurrences to authenticated;
