-- Persistência da conferência de férias vinculada à competência da folha.
-- Esta tabela registra a revisão e os valores de referência; não gera rubricas financeiras.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.employee_vacation_schedules'::regclass and conname='employee_vacation_schedules_org_id_id_key') then
    alter table public.employee_vacation_schedules add constraint employee_vacation_schedules_org_id_id_key unique (organization_id,id);
  end if;
end $$;
create table if not exists public.payroll_vacation_reviews (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 vacation_schedule_id uuid not null,
 payroll_run_id uuid not null,
 payroll_entry_id uuid not null,
 employee_id uuid not null,
 salary_history_id uuid not null references public.employee_salary_history(id),
 reference_date date not null,
 salary_amount numeric(14,2) not null check (salary_amount>0),
 vacation_amount numeric(14,2) not null check (vacation_amount>=0),
 vacation_third_amount numeric(14,2) not null check (vacation_third_amount>=0),
 allowance_amount numeric(14,2) not null check (allowance_amount>=0),
 allowance_third_amount numeric(14,2) not null check (allowance_third_amount>=0),
 gross_total numeric(14,2) not null check (gross_total>=0),
 status text not null default 'reviewed' check (status in ('reviewed','posted','cancelled')),
 reviewed_by uuid references auth.users(id) on delete set null,
 reviewed_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 constraint payroll_vacation_reviews_schedule_unique unique (organization_id,vacation_schedule_id),
 constraint payroll_vacation_reviews_schedule_fk foreign key (organization_id,vacation_schedule_id) references public.employee_vacation_schedules(organization_id,id),
 constraint payroll_vacation_reviews_run_fk foreign key (organization_id,payroll_run_id) references public.payroll_runs(organization_id,id),
 constraint payroll_vacation_reviews_entry_fk foreign key (organization_id,payroll_entry_id) references public.payroll_entries(organization_id,id),
 constraint payroll_vacation_reviews_employee_fk foreign key (organization_id,employee_id) references public.employees(organization_id,id)
);
create index if not exists payroll_vacation_reviews_run_idx on public.payroll_vacation_reviews(organization_id,payroll_run_id);
alter table public.payroll_vacation_reviews enable row level security;
drop policy if exists payroll_vacation_reviews_select on public.payroll_vacation_reviews;
create policy payroll_vacation_reviews_select on public.payroll_vacation_reviews for select to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id=payroll_vacation_reviews.organization_id and m.user_id=(select auth.uid()) and m.status='active' and m.role in ('owner','admin','hr_manager','payroll')));
drop policy if exists payroll_vacation_reviews_insert on public.payroll_vacation_reviews;
create policy payroll_vacation_reviews_insert on public.payroll_vacation_reviews for insert to authenticated with check (status='reviewed' and reviewed_by=(select auth.uid()) and exists (select 1 from public.organization_memberships m where m.organization_id=payroll_vacation_reviews.organization_id and m.user_id=(select auth.uid()) and m.status='active' and m.role in ('owner','admin','hr_manager','payroll')));
drop policy if exists payroll_vacation_reviews_update on public.payroll_vacation_reviews;
create policy payroll_vacation_reviews_update on public.payroll_vacation_reviews for update to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id=payroll_vacation_reviews.organization_id and m.user_id=(select auth.uid()) and m.status='active' and m.role in ('owner','admin','hr_manager','payroll'))) with check (exists (select 1 from public.organization_memberships m where m.organization_id=payroll_vacation_reviews.organization_id and m.user_id=(select auth.uid()) and m.status='active' and m.role in ('owner','admin','hr_manager','payroll')));
create or replace function public.guard_payroll_vacation_review() returns trigger language plpgsql set search_path=public as $$
declare run_status text; schedule_status text; schedule_employee uuid; entry_employee uuid;
begin
 if tg_op='DELETE' then
  select status into run_status from public.payroll_runs where id=old.payroll_run_id and organization_id=old.organization_id;
  if run_status='closed' then raise exception 'Não é permitido alterar conferências de férias de uma competência fechada.'; end if;
  return old;
 end if;
 select status into run_status from public.payroll_runs where id=new.payroll_run_id and organization_id=new.organization_id;
 if run_status is null then raise exception 'Competência da folha não encontrada.'; end if;
 if run_status in ('closed','cancelled') then raise exception 'A conferência de férias exige uma competência aberta.'; end if;
 select status,employee_id into schedule_status,schedule_employee from public.employee_vacation_schedules where id=new.vacation_schedule_id and organization_id=new.organization_id;
 if schedule_status is distinct from 'approved' or schedule_employee is distinct from new.employee_id then raise exception 'A programação deve estar aprovada e pertencer ao colaborador informado.'; end if;
 select employee_id into entry_employee from public.payroll_entries where id=new.payroll_entry_id and payroll_run_id=new.payroll_run_id and organization_id=new.organization_id;
 if entry_employee is distinct from new.employee_id then raise exception 'O lançamento da folha deve pertencer ao mesmo colaborador e competência.'; end if;
 return new;
end; $$;
drop trigger if exists payroll_vacation_reviews_guard on public.payroll_vacation_reviews;
create trigger payroll_vacation_reviews_guard before insert or update or delete on public.payroll_vacation_reviews for each row execute function public.guard_payroll_vacation_review();
grant select,insert,update on public.payroll_vacation_reviews to authenticated;
