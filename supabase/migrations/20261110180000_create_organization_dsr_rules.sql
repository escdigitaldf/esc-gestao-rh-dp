create table if not exists public.organization_dsr_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_name text not null check (length(btrim(rule_name)) between 3 and 160),
  professional_category text,
  union_name text,
  source_type text not null check (source_type in ('law','cct','act','internal_policy')),
  source_identifier text,
  validity_from date,
  validity_to date,
  document_reference text,
  rule_summary text,
  calculation_method text,
  calculation_parameters jsonb not null default '{}'::jsonb,
  status text not null default 'pending_validation' check (status in ('pending_validation','validated','suspended')),
  validation_notes text,
  created_by uuid references auth.users(id) on delete set null,
  validated_by uuid references auth.users(id) on delete set null,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_dsr_rules_validity_check check (validity_to is null or validity_from is null or validity_to >= validity_from),
  constraint organization_dsr_rules_validation_audit_check check (
    (status <> 'validated') or (validated_by is not null and validated_at is not null)
  )
);

create index if not exists organization_dsr_rules_org_status_idx
  on public.organization_dsr_rules (organization_id, status, validity_from desc);

alter table public.employee_work_schedules
  add column if not exists dsr_rule_id uuid references public.organization_dsr_rules(id) on delete restrict;

create index if not exists employee_work_schedules_dsr_rule_idx
  on public.employee_work_schedules (organization_id, dsr_rule_id);

alter table public.organization_dsr_rules enable row level security;

drop policy if exists organization_dsr_rules_hr_access on public.organization_dsr_rules;
create policy organization_dsr_rules_hr_access
on public.organization_dsr_rules
for all
to authenticated
using (
  exists (
    select 1 from public.organization_memberships m
    where m.organization_id = organization_dsr_rules.organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any (array['owner','admin','hr_manager','payroll'])
  )
)
with check (
  exists (
    select 1 from public.organization_memberships m
    where m.organization_id = organization_dsr_rules.organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any (array['owner','admin','hr_manager','payroll'])
  )
);

grant select, insert, update on public.organization_dsr_rules to authenticated;

create or replace function public.guard_organization_dsr_rule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending_validation' then
      raise exception 'Nova regra de DSR deve iniciar pendente de validação.';
    end if;
    if new.created_by is distinct from (select auth.uid()) then
      raise exception 'Responsável pelo cadastro inválido.';
    end if;
  elsif tg_op = 'UPDATE' then
    if old.organization_id <> new.organization_id then
      raise exception 'Não é permitido transferir uma regra entre organizações.';
    end if;
    if old.status = 'validated' and (
      new.rule_name is distinct from old.rule_name or
      new.professional_category is distinct from old.professional_category or
      new.union_name is distinct from old.union_name or
      new.source_type is distinct from old.source_type or
      new.source_identifier is distinct from old.source_identifier or
      new.validity_from is distinct from old.validity_from or
      new.validity_to is distinct from old.validity_to or
      new.document_reference is distinct from old.document_reference or
      new.rule_summary is distinct from old.rule_summary or
      new.calculation_method is distinct from old.calculation_method or
      new.calculation_parameters is distinct from old.calculation_parameters
    ) then
      raise exception 'Regra validada não pode ter seu conteúdo alterado. Cadastre uma nova versão.';
    end if;
    if old.status <> 'validated' and new.status = 'validated' then
      if new.validated_by is distinct from (select auth.uid()) or new.validated_at is null then
        raise exception 'A validação exige identificação do responsável e data.';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists guard_organization_dsr_rule on public.organization_dsr_rules;
create trigger guard_organization_dsr_rule
before insert or update on public.organization_dsr_rules
for each row execute function public.guard_organization_dsr_rule();

create or replace function public.guard_schedule_dsr_rule_organization()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rule_org uuid;
begin
  if new.dsr_rule_id is not null then
    select r.organization_id into v_rule_org
    from public.organization_dsr_rules r
    where r.id = new.dsr_rule_id;
    if v_rule_org is null or v_rule_org <> new.organization_id then
      raise exception 'A regra de DSR deve pertencer à mesma organização da escala.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_schedule_dsr_rule_organization on public.employee_work_schedules;
create trigger guard_schedule_dsr_rule_organization
before insert or update of dsr_rule_id, organization_id on public.employee_work_schedules
for each row execute function public.guard_schedule_dsr_rule_organization();

revoke all on function public.guard_organization_dsr_rule() from public, anon;
revoke all on function public.guard_schedule_dsr_rule_organization() from public, anon;
