-- Performance review cycles and individual review records.
create table if not exists public.performance_review_cycles (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null,
 period_start date not null,
 period_end date not null,
 review_deadline date,
 status text not null default 'planning' check(status in ('planning','open','closed','cancelled')),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint performance_review_cycles_dates_chk check(period_end >= period_start),
 unique(organization_id,name)
);
create table if not exists public.employee_performance_reviews (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 cycle_id uuid not null references public.performance_review_cycles(id) on delete cascade,
 employee_id uuid not null references public.employees(id) on delete cascade,
 evaluator_user_id uuid references auth.users(id) on delete set null,
 performance_score numeric(4,2) check(performance_score between 0 and 10),
 strengths text,
 development_points text,
 action_plan text,
 reviewer_notes text,
 status text not null default 'pending' check(status in ('pending','in_progress','completed','cancelled')),
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(cycle_id,employee_id)
);
create index if not exists performance_review_cycles_org_period_idx on public.performance_review_cycles(organization_id,period_start desc);
create index if not exists employee_performance_reviews_org_cycle_idx on public.employee_performance_reviews(organization_id,cycle_id,status);
create or replace function public.guard_employee_performance_review()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
 if not exists(select 1 from public.employees e where e.id=new.employee_id and e.organization_id=new.organization_id) then
  raise exception 'Colaborador não pertence à organização informada.';
 end if;
 if not exists(select 1 from public.performance_review_cycles c where c.id=new.cycle_id and c.organization_id=new.organization_id and c.status in ('open','planning')) then
  raise exception 'Ciclo inexistente, encerrado ou pertencente a outra organização.';
 end if;
 if new.evaluator_user_id is not null and not exists(select 1 from public.organization_memberships m where m.organization_id=new.organization_id and m.user_id=new.evaluator_user_id and m.status='active') then
  raise exception 'Avaliador não possui vínculo ativo com a organização.';
 end if;
 new.updated_at:=now();
 if new.status='completed' and new.completed_at is null then new.completed_at:=now(); end if;
 return new;
end;
$$;
drop trigger if exists trg_guard_employee_performance_review on public.employee_performance_reviews;
create trigger trg_guard_employee_performance_review before insert or update on public.employee_performance_reviews for each row execute function public.guard_employee_performance_review();
create or replace function public.touch_performance_cycle_updated_at()
returns trigger language plpgsql set search_path=''
as $$ begin new.updated_at:=now(); return new; end; $$;
drop trigger if exists trg_touch_performance_cycle_updated_at on public.performance_review_cycles;
create trigger trg_touch_performance_cycle_updated_at before update on public.performance_review_cycles for each row execute function public.touch_performance_cycle_updated_at();
alter table public.performance_review_cycles enable row level security;
alter table public.employee_performance_reviews enable row level security;
drop policy if exists performance_cycles_hr_access on public.performance_review_cycles;
create policy performance_cycles_hr_access on public.performance_review_cycles for all to authenticated
using(exists(select 1 from public.organization_memberships m where m.organization_id=performance_review_cycles.organization_id and m.user_id=(select auth.uid()) and m.status='active' and m.role=any(array['owner','admin','hr_manager'])))
with check(exists(select 1 from public.organization_memberships m where m.organization_id=performance_review_cycles.organization_id and m.user_id=(select auth.uid()) and m.status='active' and m.role=any(array['owner','admin','hr_manager'])));
drop policy if exists performance_reviews_hr_access on public.employee_performance_reviews;
create policy performance_reviews_hr_access on public.employee_performance_reviews for all to authenticated
using(exists(select 1 from public.organization_memberships m where m.organization_id=employee_performance_reviews.organization_id and m.user_id=(select auth.uid()) and m.status='active' and m.role=any(array['owner','admin','hr_manager'])))
with check(exists(select 1 from public.organization_memberships m where m.organization_id=employee_performance_reviews.organization_id and m.user_id=(select auth.uid()) and m.status='active' and m.role=any(array['owner','admin','hr_manager'])));
grant select,insert,update,delete on public.performance_review_cycles to authenticated;
grant select,insert,update,delete on public.employee_performance_reviews to authenticated;
