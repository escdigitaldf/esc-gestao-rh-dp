-- Reconciliation of employer-charge previews against values transcribed from official guides.
-- This layer is read-only with respect to payroll and never creates payments or tax filings.

create table if not exists public.payroll_employer_charge_guide_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  preview_id uuid not null references public.payroll_employer_charge_previews(id) on delete restrict,
  contribution_key text not null check (contribution_key in ('employer_inss','rat','third_parties','payroll_pis')),
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
  constraint payroll_employer_charge_guide_values_preview_key unique (preview_id, contribution_key),
  constraint payroll_employer_charge_guide_values_payment_date_chk check (paid_at is null or paid_amount is not null)
);

create index if not exists payroll_employer_charge_guide_values_org_preview_idx
  on public.payroll_employer_charge_guide_values (organization_id, preview_id);

alter table public.payroll_employer_charge_guide_values enable row level security;

drop policy if exists payroll_employer_charge_guide_values_select on public.payroll_employer_charge_guide_values;
create policy payroll_employer_charge_guide_values_select
on public.payroll_employer_charge_guide_values for select to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = payroll_employer_charge_guide_values.organization_id
    and m.user_id = (select auth.uid()) and m.status = 'active'
));

drop policy if exists payroll_employer_charge_guide_values_insert on public.payroll_employer_charge_guide_values;
create policy payroll_employer_charge_guide_values_insert
on public.payroll_employer_charge_guide_values for insert to authenticated
with check (
  created_by = (select auth.uid()) and updated_by = (select auth.uid())
  and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = payroll_employer_charge_guide_values.organization_id
      and m.user_id = (select auth.uid()) and m.status = 'active'
      and m.role = any(array['owner','admin','hr_manager','payroll'])
  )
  and exists (
    select 1 from public.payroll_employer_charge_previews p
    where p.id = payroll_employer_charge_guide_values.preview_id
      and p.organization_id = payroll_employer_charge_guide_values.organization_id
  )
);

drop policy if exists payroll_employer_charge_guide_values_update on public.payroll_employer_charge_guide_values;
create policy payroll_employer_charge_guide_values_update
on public.payroll_employer_charge_guide_values for update to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = payroll_employer_charge_guide_values.organization_id
    and m.user_id = (select auth.uid()) and m.status = 'active'
    and m.role = any(array['owner','admin','hr_manager','payroll'])
))
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = payroll_employer_charge_guide_values.organization_id
      and m.user_id = (select auth.uid()) and m.status = 'active'
      and m.role = any(array['owner','admin','hr_manager','payroll'])
  )
  and exists (
    select 1 from public.payroll_employer_charge_previews p
    where p.id = payroll_employer_charge_guide_values.preview_id
      and p.organization_id = payroll_employer_charge_guide_values.organization_id
  )
);

create table if not exists public.payroll_employer_charge_guide_value_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  guide_value_id uuid not null,
  action text not null check (action in ('INSERT','UPDATE')),
  old_record jsonb,
  new_record jsonb not null,
  actor_id uuid,
  occurred_at timestamptz not null default now()
);

create index if not exists payroll_employer_charge_guide_value_audit_lookup_idx
  on public.payroll_employer_charge_guide_value_audit (organization_id, guide_value_id, occurred_at desc);

alter table public.payroll_employer_charge_guide_value_audit enable row level security;

drop policy if exists payroll_employer_charge_guide_value_audit_select on public.payroll_employer_charge_guide_value_audit;
create policy payroll_employer_charge_guide_value_audit_select
on public.payroll_employer_charge_guide_value_audit for select to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = payroll_employer_charge_guide_value_audit.organization_id
    and m.user_id = (select auth.uid()) and m.status = 'active'
    and m.role = any(array['owner','admin','hr_manager','payroll'])
));

create or replace function public.audit_payroll_employer_charge_guide_value()
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
      or new.preview_id <> old.preview_id
      or new.contribution_key <> old.contribution_key
      or new.created_by <> old.created_by
      or new.created_at <> old.created_at then
      raise exception 'A origem e a identidade do registro de guia são imutáveis.';
    end if;
  end if;

  insert into public.payroll_employer_charge_guide_value_audit (
    organization_id, guide_value_id, action, old_record, new_record, actor_id
  ) values (
    new.organization_id, new.id, tg_op,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new), auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists audit_payroll_employer_charge_guide_value_trigger on public.payroll_employer_charge_guide_values;
create trigger audit_payroll_employer_charge_guide_value_trigger
before insert or update on public.payroll_employer_charge_guide_values
for each row execute function public.audit_payroll_employer_charge_guide_value();

revoke all on public.payroll_employer_charge_guide_values from anon;
revoke delete on public.payroll_employer_charge_guide_values from authenticated, anon;
grant select, insert, update on public.payroll_employer_charge_guide_values to authenticated;
revoke all on public.payroll_employer_charge_guide_value_audit from anon, authenticated;
grant select on public.payroll_employer_charge_guide_value_audit to authenticated;

create or replace view public.payroll_employer_charge_reconciliation
with (security_invoker = true)
as
select
  p.organization_id,
  p.id as preview_id,
  p.payroll_run_id,
  p.competence,
  p.status as preview_status,
  p.calculation_version,
  p.created_at as preview_created_at,
  c.contribution_key,
  c.contribution_label,
  c.calculated_amount,
  g.id as guide_value_id,
  g.guide_reference,
  g.assessed_amount,
  g.paid_amount,
  g.due_date,
  g.paid_at,
  g.evidence_reference,
  g.notes,
  case
    when p.status <> 'preview' then 'blocked_preview'
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
from public.payroll_employer_charge_previews p
cross join lateral (
  values
    ('employer_inss'::text, 'INSS patronal'::text, p.total_employer_inss),
    ('rat'::text, 'RAT ajustado pelo FAP'::text, p.total_rat),
    ('third_parties'::text, 'Terceiros'::text, p.total_third_parties),
    ('payroll_pis'::text, 'PIS sobre folha'::text, p.total_payroll_pis)
) as c(contribution_key, contribution_label, calculated_amount)
left join public.payroll_employer_charge_guide_values g
  on g.preview_id = p.id
  and g.organization_id = p.organization_id
  and g.contribution_key = c.contribution_key;

grant select on public.payroll_employer_charge_reconciliation to authenticated;
