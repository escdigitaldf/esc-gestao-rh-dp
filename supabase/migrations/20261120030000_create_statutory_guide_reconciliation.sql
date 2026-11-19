-- Conciliação de INSS do segurado, IRRF e FGTS por folha.
-- Os valores calculados vêm exclusivamente dos itens já gravados na folha.
-- A guia e o pagamento são informados manualmente com referência documental.

create table if not exists public.payroll_statutory_guide_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payroll_run_id uuid not null,
  obligation_key text not null check (obligation_key in ('employee_inss','irrf','fgts')),
  guide_reference text not null,
  assessed_amount numeric(14,2) not null check (assessed_amount >= 0),
  paid_amount numeric(14,2) check (paid_amount is null or paid_amount >= 0),
  due_date date,
  paid_at date,
  evidence_reference text,
  notes text,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_statutory_guide_values_run_fk
    foreign key (payroll_run_id, organization_id)
    references public.payroll_runs(id, organization_id) on delete restrict,
  constraint payroll_statutory_guide_values_run_obligation_key
    unique (payroll_run_id, obligation_key),
  constraint payroll_statutory_guide_values_payment_date_chk
    check (paid_at is null or paid_amount is not null)
);

create index if not exists payroll_statutory_guide_values_org_run_idx
  on public.payroll_statutory_guide_values (organization_id, payroll_run_id);

alter table public.payroll_statutory_guide_values enable row level security;

drop policy if exists payroll_statutory_guide_values_select on public.payroll_statutory_guide_values;
create policy payroll_statutory_guide_values_select
on public.payroll_statutory_guide_values for select to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = payroll_statutory_guide_values.organization_id
    and m.user_id = (select auth.uid()) and m.status = 'active'
));

drop policy if exists payroll_statutory_guide_values_insert on public.payroll_statutory_guide_values;
create policy payroll_statutory_guide_values_insert
on public.payroll_statutory_guide_values for insert to authenticated
with check (
  created_by = (select auth.uid()) and updated_by = (select auth.uid())
  and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = payroll_statutory_guide_values.organization_id
      and m.user_id = (select auth.uid()) and m.status = 'active'
      and m.role = any(array['owner','admin','hr_manager','payroll'])
  )
  and exists (
    select 1 from public.payroll_runs r
    where r.id = payroll_statutory_guide_values.payroll_run_id
      and r.organization_id = payroll_statutory_guide_values.organization_id
  )
);

drop policy if exists payroll_statutory_guide_values_update on public.payroll_statutory_guide_values;
create policy payroll_statutory_guide_values_update
on public.payroll_statutory_guide_values for update to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = payroll_statutory_guide_values.organization_id
    and m.user_id = (select auth.uid()) and m.status = 'active'
    and m.role = any(array['owner','admin','hr_manager','payroll'])
))
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = payroll_statutory_guide_values.organization_id
      and m.user_id = (select auth.uid()) and m.status = 'active'
      and m.role = any(array['owner','admin','hr_manager','payroll'])
  )
  and exists (
    select 1 from public.payroll_runs r
    where r.id = payroll_statutory_guide_values.payroll_run_id
      and r.organization_id = payroll_statutory_guide_values.organization_id
  )
);

create table if not exists public.payroll_statutory_guide_value_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  guide_value_id uuid not null,
  action text not null check (action in ('INSERT','UPDATE')),
  old_record jsonb,
  new_record jsonb not null,
  actor_id uuid,
  occurred_at timestamptz not null default now()
);

create index if not exists payroll_statutory_guide_value_audit_lookup_idx
  on public.payroll_statutory_guide_value_audit (organization_id, guide_value_id, occurred_at desc);

alter table public.payroll_statutory_guide_value_audit enable row level security;

drop policy if exists payroll_statutory_guide_value_audit_select on public.payroll_statutory_guide_value_audit;
create policy payroll_statutory_guide_value_audit_select
on public.payroll_statutory_guide_value_audit for select to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = payroll_statutory_guide_value_audit.organization_id
    and m.user_id = (select auth.uid()) and m.status = 'active'
    and m.role = any(array['owner','admin','hr_manager','payroll'])
));

create or replace function public.audit_payroll_statutory_guide_value()
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
      or new.payroll_run_id <> old.payroll_run_id
      or new.obligation_key <> old.obligation_key
      or new.created_by <> old.created_by
      or new.created_at <> old.created_at then
      raise exception 'A origem e a identidade do registro de guia são imutáveis.';
    end if;
  end if;

  insert into public.payroll_statutory_guide_value_audit (
    organization_id, guide_value_id, action, old_record, new_record, actor_id
  ) values (
    new.organization_id, new.id, tg_op,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new), auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists audit_payroll_statutory_guide_value_trigger on public.payroll_statutory_guide_values;
create trigger audit_payroll_statutory_guide_value_trigger
before insert or update on public.payroll_statutory_guide_values
for each row execute function public.audit_payroll_statutory_guide_value();

revoke all on public.payroll_statutory_guide_values from anon;
revoke delete on public.payroll_statutory_guide_values from authenticated, anon;
grant select, insert, update on public.payroll_statutory_guide_values to authenticated;
revoke all on public.payroll_statutory_guide_value_audit from anon, authenticated;
grant select on public.payroll_statutory_guide_value_audit to authenticated;

create or replace view public.payroll_statutory_guide_reconciliation
with (security_invoker = true)
as
with calculated as (
  select
    r.organization_id,
    r.id as payroll_run_id,
    r.reference_month as competence,
    r.status as payroll_run_status,
    c.obligation_key,
    c.obligation_label,
    coalesce(sum(i.amount),0)::numeric(14,2) as calculated_amount
  from public.payroll_runs r
  cross join lateral (values
    ('employee_inss'::text, 'INSS do segurado'::text, 'INSS_EMPREGADO'::text, 'deduction'::text),
    ('irrf'::text, 'IRRF mensal'::text, 'IRRF_MENSAL'::text, 'deduction'::text),
    ('fgts'::text, 'FGTS estimado'::text, 'FGTS_MENSAL'::text, 'employer_charge'::text)
  ) c(obligation_key, obligation_label, item_code, item_type)
  left join public.payroll_entries e
    on e.payroll_run_id = r.id and e.organization_id = r.organization_id
  left join public.payroll_entry_items i
    on i.payroll_entry_id = e.id
    and i.organization_id = e.organization_id
    and i.code = c.item_code
    and i.item_type = c.item_type
  group by r.organization_id, r.id, r.reference_month, r.status,
    c.obligation_key, c.obligation_label
)
select
  c.organization_id, c.payroll_run_id, c.competence, c.payroll_run_status,
  c.obligation_key, c.obligation_label, c.calculated_amount,
  g.id as guide_value_id, g.guide_reference, g.assessed_amount, g.paid_amount,
  g.due_date, g.paid_at, g.evidence_reference, g.notes,
  case
    when c.payroll_run_status <> 'closed' then 'payroll_not_closed'
    when g.id is null then 'missing_guide_value'
    when abs(g.assessed_amount - c.calculated_amount) <= 0.01 then 'matched'
    else 'amount_difference'
  end as reconciliation_status,
  case
    when g.id is null then 'not_recorded'
    when g.paid_at is not null and g.paid_amount is not null then 'payment_recorded'
    when g.paid_amount is not null then 'paid_amount_informed'
    else 'payment_not_confirmed'
  end as payment_status,
  case when g.id is null then null else round(g.assessed_amount - c.calculated_amount,2) end as difference_amount
from calculated c
left join public.payroll_statutory_guide_values g
  on g.payroll_run_id = c.payroll_run_id
  and g.organization_id = c.organization_id
  and g.obligation_key = c.obligation_key;

grant select on public.payroll_statutory_guide_reconciliation to authenticated;
