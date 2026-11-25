-- Employee benefits catalog and assignments. Apply only after reviewing the complete migration baseline.
create table if not exists public.benefit_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  benefit_category text not null check (benefit_category in ('meal','food','transport','health','dental','life_insurance','childcare','education','other')),
  description text,
  provider_name text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
create table if not exists public.employee_benefit_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  benefit_type_id uuid not null references public.benefit_types(id) on delete restrict,
  effective_from date not null,
  effective_to date,
  employer_amount numeric(12,2) not null default 0 check (employer_amount >= 0),
  employee_amount numeric(12,2) not null default 0 check (employee_amount >= 0),
  reference_code text,
  status text not null default 'active' check (status in ('active','suspended','ended')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_benefit_assignments_dates_chk check (effective_to is null or effective_to >= effective_from)
);
create index if not exists employee_benefit_assignments_org_employee_idx on public.employee_benefit_assignments(organization_id, employee_id, effective_from desc);
create index if not exists employee_benefit_assignments_org_type_idx on public.employee_benefit_assignments(organization_id, benefit_type_id, status);
create or replace function public.guard_employee_benefit_assignment()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if not exists (select 1 from public.employees e where e.id = new.employee_id and e.organization_id = new.organization_id) then
    raise exception 'O colaborador não pertence à organização informada.';
  end if;
  if not exists (select 1 from public.benefit_types b where b.id = new.benefit_type_id and b.organization_id = new.organization_id) then
    raise exception 'O benefício não pertence à organização informada.';
  end if;
  if new.status = 'active' and exists (
    select 1 from public.employee_benefit_assignments a
    where a.organization_id = new.organization_id and a.employee_id = new.employee_id
      and a.benefit_type_id = new.benefit_type_id and a.status = 'active'
      and a.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and daterange(a.effective_from, coalesce(a.effective_to + 1, 'infinity'::date), '[)')
          && daterange(new.effective_from, coalesce(new.effective_to + 1, 'infinity'::date), '[)')
  ) then
    raise exception 'Já existe uma atribuição ativa deste benefício com vigência sobreposta para o colaborador.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_guard_employee_benefit_assignment on public.employee_benefit_assignments;
create trigger trg_guard_employee_benefit_assignment before insert or update on public.employee_benefit_assignments for each row execute function public.guard_employee_benefit_assignment();
create or replace function public.touch_benefit_type_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;
drop trigger if exists trg_touch_benefit_type_updated_at on public.benefit_types;
create trigger trg_touch_benefit_type_updated_at before update on public.benefit_types for each row execute function public.touch_benefit_type_updated_at();
alter table public.benefit_types enable row level security;
alter table public.employee_benefit_assignments enable row level security;
drop policy if exists benefit_types_hr_access on public.benefit_types;
create policy benefit_types_hr_access on public.benefit_types for all to authenticated
using (exists (select 1 from public.organization_memberships m where m.organization_id = benefit_types.organization_id and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = any(array['owner','admin','hr_manager','payroll'])))
with check (exists (select 1 from public.organization_memberships m where m.organization_id = benefit_types.organization_id and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = any(array['owner','admin','hr_manager','payroll'])));
drop policy if exists employee_benefit_assignments_hr_access on public.employee_benefit_assignments;
create policy employee_benefit_assignments_hr_access on public.employee_benefit_assignments for all to authenticated
using (exists (select 1 from public.organization_memberships m where m.organization_id = employee_benefit_assignments.organization_id and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = any(array['owner','admin','hr_manager','payroll'])))
with check (exists (select 1 from public.organization_memberships m where m.organization_id = employee_benefit_assignments.organization_id and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = any(array['owner','admin','hr_manager','payroll'])));
grant select, insert, update, delete on public.benefit_types to authenticated;
grant select, insert, update, delete on public.employee_benefit_assignments to authenticated;
