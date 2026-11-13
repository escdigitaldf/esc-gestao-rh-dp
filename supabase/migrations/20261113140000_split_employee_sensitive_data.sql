-- Separate employee personal identity from compensation and payment details.
-- This is an additive compatibility phase: legacy columns remain until every
-- application and payroll dependency is migrated and verified.
create table if not exists public.employee_personal_data (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  cpf text,
  birth_date date,
  gender text,
  marital_status text,
  nationality text,
  naturality_city text,
  naturality_state text,
  mother_name text,
  father_name text,
  rg_number text,
  rg_issuer text,
  rg_state text,
  rg_issue_date date,
  pis_pasep text,
  ctps_number text,
  ctps_series text,
  ctps_state text,
  voter_registration text,
  voter_zone text,
  voter_section text,
  military_certificate text,
  education_level text,
  personal_email text,
  phone text,
  mobile_phone text,
  zip_code text,
  address_street text,
  address_number text,
  address_complement text,
  neighborhood text,
  city text,
  state text,
  emergency_contact_name text,
  emergency_contact_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint employee_personal_data_org_employee_unique unique (organization_id, employee_id),
  constraint employee_personal_data_employee_fk
    foreign key (organization_id, employee_id)
    references public.employees(organization_id, id)
    on update restrict on delete cascade
);

create table if not exists public.employee_payment_data (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  salary_amount numeric(14,2),
  salary_type text,
  payment_method text,
  bank_name text,
  bank_branch text,
  bank_account text,
  bank_account_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint employee_payment_data_org_employee_unique unique (organization_id, employee_id),
  constraint employee_payment_data_employee_fk
    foreign key (organization_id, employee_id)
    references public.employees(organization_id, id)
    on update restrict on delete cascade
);

create index if not exists employee_personal_data_org_idx
  on public.employee_personal_data(organization_id, employee_id);
create index if not exists employee_payment_data_org_idx
  on public.employee_payment_data(organization_id, employee_id);

alter table public.employee_personal_data enable row level security;
alter table public.employee_payment_data enable row level security;

grant select, insert, update, delete on public.employee_personal_data to authenticated;
grant select, insert, update, delete on public.employee_payment_data to authenticated;

drop policy if exists employee_personal_data_read_hr on public.employee_personal_data;
create policy employee_personal_data_read_hr
on public.employee_personal_data for select to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = employee_personal_data.organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role in ('owner','admin','hr_manager')
));

drop policy if exists employee_personal_data_insert_hr on public.employee_personal_data;
create policy employee_personal_data_insert_hr
on public.employee_personal_data for insert to authenticated
with check (
  (created_by is null or created_by = (select auth.uid()))
  and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = employee_personal_data.organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role in ('owner','admin','hr_manager')
  )
);

drop policy if exists employee_personal_data_update_hr on public.employee_personal_data;
create policy employee_personal_data_update_hr
on public.employee_personal_data for update to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = employee_personal_data.organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role in ('owner','admin','hr_manager')
))
with check (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = employee_personal_data.organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role in ('owner','admin','hr_manager')
));

drop policy if exists employee_personal_data_delete_admin on public.employee_personal_data;
create policy employee_personal_data_delete_admin
on public.employee_personal_data for delete to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = employee_personal_data.organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role in ('owner','admin')
));

drop policy if exists employee_payment_data_read_payroll on public.employee_payment_data;
create policy employee_payment_data_read_payroll
on public.employee_payment_data for select to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = employee_payment_data.organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role in ('owner','admin','hr_manager','payroll')
));

drop policy if exists employee_payment_data_insert_payroll on public.employee_payment_data;
create policy employee_payment_data_insert_payroll
on public.employee_payment_data for insert to authenticated
with check (
  (created_by is null or created_by = (select auth.uid()))
  and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = employee_payment_data.organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role in ('owner','admin','hr_manager','payroll')
  )
);

drop policy if exists employee_payment_data_update_payroll on public.employee_payment_data;
create policy employee_payment_data_update_payroll
on public.employee_payment_data for update to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = employee_payment_data.organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role in ('owner','admin','hr_manager','payroll')
))
with check (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = employee_payment_data.organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role in ('owner','admin','hr_manager','payroll')
));

drop policy if exists employee_payment_data_delete_admin on public.employee_payment_data;
create policy employee_payment_data_delete_admin
on public.employee_payment_data for delete to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = employee_payment_data.organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role in ('owner','admin')
));

comment on table public.employee_personal_data is
  'Dados pessoais e de identificação com acesso restrito a owner/admin/hr_manager. Migração aditiva; legado em employees permanece temporariamente.';
comment on table public.employee_payment_data is
  'Dados remuneratórios e bancários com acesso restrito a owner/admin/hr_manager/payroll. Migração aditiva; legado em employees permanece temporariamente.';
