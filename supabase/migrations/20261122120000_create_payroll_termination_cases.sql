-- Módulo de rescisões: abertura e acompanhamento auditável, sem cálculo automático presumido.
create table if not exists public.payroll_termination_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  termination_reason text not null check (termination_reason in (
    'employer_without_cause','employee_resignation','mutual_agreement',
    'employer_with_cause','fixed_term_end','indirect_termination',
    'death','other'
  )),
  notice_type text not null check (notice_type in ('worked','indemnified','waived','not_applicable','pending_review')),
  notice_date date,
  last_worked_date date,
  termination_date date not null,
  projected_notice_end_date date,
  payment_deadline date,
  case_status text not null default 'draft'
    check (case_status in ('draft','in_review','ready_for_validation','cancelled')),
  calculation_status text not null default 'pending_manual_review'
    check (calculation_status in ('pending_manual_review','blocked_missing_data','validated')),
  calculation_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(calculation_snapshot) = 'object'),
  checklist jsonb not null default '[]'::jsonb
    check (jsonb_typeof(checklist) = 'array'),
  notes text,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_termination_case_dates_chk check (
    (notice_date is null or notice_date <= termination_date)
    and (last_worked_date is null or last_worked_date <= termination_date)
    and (projected_notice_end_date is null or projected_notice_end_date >= termination_date)
    and (payment_deadline is null or payment_deadline >= termination_date)
  )
);

create unique index if not exists payroll_termination_one_open_case_per_employee
  on public.payroll_termination_cases (organization_id, employee_id)
  where case_status <> 'cancelled';

create index if not exists payroll_termination_cases_org_status_date_idx
  on public.payroll_termination_cases (organization_id, case_status, termination_date desc);

alter table public.payroll_termination_cases enable row level security;

drop policy if exists payroll_termination_cases_select on public.payroll_termination_cases;
create policy payroll_termination_cases_select
on public.payroll_termination_cases for select to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = payroll_termination_cases.organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role = any(array['owner','admin','hr_manager','payroll'])
));

drop policy if exists payroll_termination_cases_insert on public.payroll_termination_cases;
create policy payroll_termination_cases_insert
on public.payroll_termination_cases for insert to authenticated
with check (
  created_by = (select auth.uid()) and updated_by = (select auth.uid())
  and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = payroll_termination_cases.organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any(array['owner','admin','hr_manager','payroll'])
  )
  and exists (
    select 1 from public.employees e
    where e.id = payroll_termination_cases.employee_id
      and e.organization_id = payroll_termination_cases.organization_id
  )
);

drop policy if exists payroll_termination_cases_update on public.payroll_termination_cases;
create policy payroll_termination_cases_update
on public.payroll_termination_cases for update to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = payroll_termination_cases.organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role = any(array['owner','admin','hr_manager','payroll'])
))
with check (
  updated_by = (select auth.uid())
  and created_by = (select auth.uid())
  and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = payroll_termination_cases.organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any(array['owner','admin','hr_manager','payroll'])
  )
  and exists (
    select 1 from public.employees e
    where e.id = payroll_termination_cases.employee_id
      and e.organization_id = payroll_termination_cases.organization_id
  )
);

create table if not exists public.payroll_termination_case_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  termination_case_id uuid not null references public.payroll_termination_cases(id) on delete restrict,
  action text not null check (action in ('INSERT','UPDATE')),
  old_record jsonb,
  new_record jsonb not null,
  actor_id uuid,
  occurred_at timestamptz not null default now()
);

create index if not exists payroll_termination_case_audit_lookup_idx
  on public.payroll_termination_case_audit (organization_id, termination_case_id, occurred_at desc);

alter table public.payroll_termination_case_audit enable row level security;

drop policy if exists payroll_termination_case_audit_select on public.payroll_termination_case_audit;
create policy payroll_termination_case_audit_select
on public.payroll_termination_case_audit for select to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = payroll_termination_case_audit.organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role = any(array['owner','admin','hr_manager','payroll'])
));

create or replace function public.audit_payroll_termination_case()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := auth.uid();
    if new.organization_id <> old.organization_id
      or new.employee_id <> old.employee_id
      or new.created_by <> old.created_by
      or new.created_at <> old.created_at then
      raise exception 'A organização, colaborador e autoria do processo rescisório são imutáveis.';
    end if;
  end if;

  insert into public.payroll_termination_case_audit (
    organization_id, termination_case_id, action, old_record, new_record, actor_id
  ) values (
    new.organization_id, new.id, tg_op,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new), auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists audit_payroll_termination_case_trigger on public.payroll_termination_cases;
create trigger audit_payroll_termination_case_trigger
before insert or update on public.payroll_termination_cases
for each row execute function public.audit_payroll_termination_case();

revoke all on public.payroll_termination_cases from anon;
revoke delete on public.payroll_termination_cases from authenticated, anon;
grant select, insert, update on public.payroll_termination_cases to authenticated;
revoke all on public.payroll_termination_case_audit from anon, authenticated;
grant select on public.payroll_termination_case_audit to authenticated;

comment on table public.payroll_termination_cases is
'Controle de processos rescisórios. A tabela registra dados, checklist e snapshots de cálculo; não calcula verbas nem efetiva desligamento automaticamente.';
