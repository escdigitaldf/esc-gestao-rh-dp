-- Memória de cálculo rescisório: itens individualizados, versionáveis e auditáveis.
-- Esta estrutura não presume fórmulas legais; valores permanecem preliminares até conferência humana.

create table if not exists public.payroll_termination_calculation_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  termination_case_id uuid not null references public.payroll_termination_cases(id) on delete restrict,
  item_code text not null,
  description text not null,
  item_type text not null check (item_type in ('earning','deduction','employer_charge','information')),
  reference_period text,
  reference_quantity numeric(14,4),
  reference_unit text,
  calculation_base numeric(14,4),
  rate numeric(14,8),
  amount numeric(14,2) not null default 0 check (amount >= 0),
  calculation_method text not null default 'manual'
    check (calculation_method in ('manual','parameter_table','formula_pending')),
  calculation_status text not null default 'pending_review'
    check (calculation_status in ('draft','pending_review','reviewed','blocked')),
  source_parameter_table_id uuid references public.payroll_parameter_tables(id) on delete restrict,
  source_parameter_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_parameter_snapshot) = 'object'),
  calculation_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(calculation_snapshot) = 'object'),
  legal_basis text,
  review_notes text,
  sort_order integer not null default 100,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_termination_item_code_chk check (length(trim(item_code)) > 0),
  constraint payroll_termination_item_description_chk check (length(trim(description)) > 0)
);

create index if not exists payroll_termination_items_case_idx
  on public.payroll_termination_calculation_items
  (organization_id, termination_case_id, sort_order, created_at);

alter table public.payroll_termination_calculation_items enable row level security;

drop policy if exists payroll_termination_items_select on public.payroll_termination_calculation_items;
create policy payroll_termination_items_select
on public.payroll_termination_calculation_items for select to authenticated
using (exists (
  select 1
  from public.organization_memberships m
  join public.payroll_termination_cases c
    on c.organization_id = m.organization_id
   and c.id = payroll_termination_calculation_items.termination_case_id
  where m.organization_id = payroll_termination_calculation_items.organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role = any(array['owner','admin','hr_manager','payroll'])
));

drop policy if exists payroll_termination_items_insert on public.payroll_termination_calculation_items;
create policy payroll_termination_items_insert
on public.payroll_termination_calculation_items for insert to authenticated
with check (
  created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and exists (
    select 1
    from public.organization_memberships m
    join public.payroll_termination_cases c
      on c.organization_id = m.organization_id
     and c.id = payroll_termination_calculation_items.termination_case_id
    where m.organization_id = payroll_termination_calculation_items.organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any(array['owner','admin','hr_manager','payroll'])
      and c.case_status <> 'cancelled'
  )
);

drop policy if exists payroll_termination_items_update on public.payroll_termination_calculation_items;
create policy payroll_termination_items_update
on public.payroll_termination_calculation_items for update to authenticated
using (exists (
  select 1
  from public.organization_memberships m
  join public.payroll_termination_cases c
    on c.organization_id = m.organization_id
   and c.id = payroll_termination_calculation_items.termination_case_id
  where m.organization_id = payroll_termination_calculation_items.organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role = any(array['owner','admin','hr_manager','payroll'])
    and c.case_status <> 'cancelled'
))
with check (
  updated_by = (select auth.uid())
  and created_by = (select auth.uid())
  and exists (
    select 1
    from public.organization_memberships m
    join public.payroll_termination_cases c
      on c.organization_id = m.organization_id
     and c.id = payroll_termination_calculation_items.termination_case_id
    where m.organization_id = payroll_termination_calculation_items.organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any(array['owner','admin','hr_manager','payroll'])
      and c.case_status <> 'cancelled'
  )
);

create table if not exists public.payroll_termination_calculation_item_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  calculation_item_id uuid not null references public.payroll_termination_calculation_items(id) on delete restrict,
  termination_case_id uuid not null references public.payroll_termination_cases(id) on delete restrict,
  action text not null check (action in ('INSERT','UPDATE')),
  old_record jsonb,
  new_record jsonb not null,
  actor_id uuid,
  occurred_at timestamptz not null default now()
);

create index if not exists payroll_termination_item_audit_lookup_idx
  on public.payroll_termination_calculation_item_audit
  (organization_id, termination_case_id, occurred_at desc);

alter table public.payroll_termination_calculation_item_audit enable row level security;

drop policy if exists payroll_termination_item_audit_select on public.payroll_termination_calculation_item_audit;
create policy payroll_termination_item_audit_select
on public.payroll_termination_calculation_item_audit for select to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = payroll_termination_calculation_item_audit.organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role = any(array['owner','admin','hr_manager','payroll'])
));

create or replace function public.audit_payroll_termination_calculation_item()
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
      or new.termination_case_id <> old.termination_case_id
      or new.created_by <> old.created_by
      or new.created_at <> old.created_at then
      raise exception 'Organização, processo rescisório e autoria do item são imutáveis.';
    end if;
  end if;

  insert into public.payroll_termination_calculation_item_audit (
    organization_id, calculation_item_id, termination_case_id,
    action, old_record, new_record, actor_id
  ) values (
    new.organization_id, new.id, new.termination_case_id,
    tg_op,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new), auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists audit_payroll_termination_calculation_item_trigger
  on public.payroll_termination_calculation_items;
create trigger audit_payroll_termination_calculation_item_trigger
before insert or update on public.payroll_termination_calculation_items
for each row execute function public.audit_payroll_termination_calculation_item();

revoke all on public.payroll_termination_calculation_items from anon;
revoke delete on public.payroll_termination_calculation_items from authenticated, anon;
grant select, insert, update on public.payroll_termination_calculation_items to authenticated;
revoke all on public.payroll_termination_calculation_item_audit from anon, authenticated;
grant select on public.payroll_termination_calculation_item_audit to authenticated;

comment on table public.payroll_termination_calculation_items is
'Itens da memória de cálculo rescisório. Valores são preliminares e não representam cálculo legal automático; cada item deve ser revisado antes da validação do processo.';
