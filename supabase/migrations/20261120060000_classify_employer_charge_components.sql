-- Trace legacy PARAM_* employer-charge items to their parameter table and
-- require an independently validated mapping before allocating by contribution.
alter table public.payroll_entry_items
  add column if not exists source_parameter_table_id uuid
    references public.payroll_parameter_tables(id) on delete restrict;

create index if not exists payroll_entry_items_source_parameter_idx
  on public.payroll_entry_items (organization_id, source_parameter_table_id)
  where source_parameter_table_id is not null;

create table if not exists public.payroll_employer_charge_component_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parameter_table_id uuid not null references public.payroll_parameter_tables(id) on delete restrict,
  contribution_key text not null check (contribution_key in ('employer_inss','rat','third_parties','payroll_pis','other')),
  source_reference text not null,
  status text not null default 'pending' check (status in ('pending','validated','inactive')),
  created_by uuid not null default auth.uid(),
  validated_by uuid,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_employer_charge_component_mapping_parameter_unique unique(parameter_table_id),
  constraint payroll_employer_charge_component_mapping_org_parameter_unique unique(organization_id,parameter_table_id),
  constraint payroll_employer_charge_component_mapping_validation_chk check (
    (status='validated' and validated_by is not null and validated_at is not null and validated_by <> created_by)
    or status <> 'validated'
  )
);

create index if not exists payroll_employer_charge_component_mapping_org_status_idx
  on public.payroll_employer_charge_component_mappings(organization_id,status);

alter table public.payroll_employer_charge_component_mappings enable row level security;

drop policy if exists payroll_employer_charge_component_mapping_select on public.payroll_employer_charge_component_mappings;
create policy payroll_employer_charge_component_mapping_select
on public.payroll_employer_charge_component_mappings for select to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id=payroll_employer_charge_component_mappings.organization_id
    and m.user_id=(select auth.uid()) and m.status='active'
));

drop policy if exists payroll_employer_charge_component_mapping_insert on public.payroll_employer_charge_component_mappings;
create policy payroll_employer_charge_component_mapping_insert
on public.payroll_employer_charge_component_mappings for insert to authenticated
with check (
  created_by=(select auth.uid()) and status='pending'
  and exists (
    select 1 from public.organization_memberships m
    where m.organization_id=payroll_employer_charge_component_mappings.organization_id
      and m.user_id=(select auth.uid()) and m.status='active'
      and m.role=any(array['owner','admin','hr_manager','payroll'])
  )
  and exists (
    select 1 from public.payroll_parameter_tables p
    where p.id=payroll_employer_charge_component_mappings.parameter_table_id
      and p.organization_id=payroll_employer_charge_component_mappings.organization_id
  )
);

drop policy if exists payroll_employer_charge_component_mapping_update on public.payroll_employer_charge_component_mappings;
create policy payroll_employer_charge_component_mapping_update
on public.payroll_employer_charge_component_mappings for update to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id=payroll_employer_charge_component_mappings.organization_id
    and m.user_id=(select auth.uid()) and m.status='active'
    and m.role=any(array['owner','admin','hr_manager','payroll'])
))
with check (
  exists (
    select 1 from public.organization_memberships m
    where m.organization_id=payroll_employer_charge_component_mappings.organization_id
      and m.user_id=(select auth.uid()) and m.status='active'
      and m.role=any(array['owner','admin','hr_manager','payroll'])
  )
  and exists (
    select 1 from public.payroll_parameter_tables p
    where p.id=payroll_employer_charge_component_mappings.parameter_table_id
      and p.organization_id=payroll_employer_charge_component_mappings.organization_id
  )
);

create table if not exists public.payroll_employer_charge_component_mapping_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mapping_id uuid not null,
  action text not null check(action in ('INSERT','UPDATE')),
  old_record jsonb,
  new_record jsonb not null,
  actor_id uuid,
  occurred_at timestamptz not null default now()
);
alter table public.payroll_employer_charge_component_mapping_audit enable row level security;
drop policy if exists payroll_employer_charge_component_mapping_audit_select on public.payroll_employer_charge_component_mapping_audit;
create policy payroll_employer_charge_component_mapping_audit_select
on public.payroll_employer_charge_component_mapping_audit for select to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id=payroll_employer_charge_component_mapping_audit.organization_id
    and m.user_id=(select auth.uid()) and m.status='active'
    and m.role=any(array['owner','admin','hr_manager','payroll'])
));

create or replace function public.guard_payroll_employer_charge_component_mapping()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.organization_id is distinct from old.organization_id
      or new.parameter_table_id is distinct from old.parameter_table_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'A origem e a identidade do mapeamento são imutáveis.';
    end if;
    if old.status='validated' then
      raise exception 'Mapeamento validado é imutável. Cadastre nova versão para corrigir a classificação.';
    end if;
    if new.status='validated' then
      if nullif(btrim(new.source_reference),'') is null then
        raise exception 'Informe o fundamento documental antes de validar.';
      end if;
      if old.created_by=(select auth.uid()) then
        raise exception 'A validação deve ser realizada por outro responsável.';
      end if;
      new.validated_by := auth.uid();
      new.validated_at := now();
    else
      new.validated_by := null;
      new.validated_at := null;
    end if;
  end if;
  new.updated_at := now();
  insert into public.payroll_employer_charge_component_mapping_audit(
    organization_id,mapping_id,action,old_record,new_record,actor_id
  ) values (
    new.organization_id,new.id,tg_op,
    case when tg_op='UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new),auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists guard_payroll_employer_charge_component_mapping_trigger on public.payroll_employer_charge_component_mappings;
create trigger guard_payroll_employer_charge_component_mapping_trigger
before insert or update on public.payroll_employer_charge_component_mappings
for each row execute function public.guard_payroll_employer_charge_component_mapping();

-- Resolve PARAM_<table_code> against the exact active parameter version for
-- the payroll competence. Ambiguity is rejected rather than silently mislinked.
create or replace function public.resolve_payroll_item_parameter_source()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_competence date;
  v_parameter_id uuid;
  v_match_count integer;
  v_table_code text;
begin
  if new.item_type <> 'employer_charge' or new.code not like 'PARAM_%' then
    return new;
  end if;
  select r.reference_month into v_competence
  from public.payroll_entries e
  join public.payroll_runs r on r.id=e.payroll_run_id and r.organization_id=e.organization_id
  where e.id=new.payroll_entry_id and e.organization_id=new.organization_id;
  if v_competence is null then
    raise exception 'Não foi possível localizar a competência do encargo parametrizado.';
  end if;
  v_table_code := substring(new.code from 7);
  select count(*)::integer, (array_agg(p.id))[1]
    into v_match_count, v_parameter_id
  from public.payroll_parameter_tables p
  where p.organization_id=new.organization_id
    and upper(regexp_replace(p.table_code,'[^A-Z0-9_]','','g'))=v_table_code
    and p.status='active'
    and p.effective_from<=v_competence
    and (p.effective_to is null or p.effective_to>=v_competence);
  if v_match_count <> 1 then
    raise exception 'O encargo % não possui uma única tabela de parâmetros ativa na competência. Corrija a vigência/código antes de gerar a folha.',new.code;
  end if;
  new.source_parameter_table_id := v_parameter_id;
  return new;
end;
$$;

drop trigger if exists resolve_payroll_item_parameter_source_trigger on public.payroll_entry_items;
create trigger resolve_payroll_item_parameter_source_trigger
before insert on public.payroll_entry_items
for each row execute function public.resolve_payroll_item_parameter_source();

revoke all on function public.guard_payroll_employer_charge_component_mapping() from public,anon,authenticated;
revoke all on function public.resolve_payroll_item_parameter_source() from public,anon,authenticated;
grant select,insert,update on public.payroll_employer_charge_component_mappings to authenticated;
revoke delete on public.payroll_employer_charge_component_mappings from authenticated,anon;
revoke all on public.payroll_employer_charge_component_mapping_audit from anon,authenticated;
grant select on public.payroll_employer_charge_component_mapping_audit to authenticated;

create or replace view public.payroll_employer_charge_component_reconciliation
with (security_invoker=true)
as
with preview_people as (
  select p.organization_id,p.id as preview_id,p.payroll_run_id,p.competence,p.status as preview_status,
    p.calculation_version,s.item->>'payroll_entry_id' as payroll_entry_id,
    s.item->>'employee_id' as employee_id,s.item->>'employee_code' as employee_code,
    s.item->>'employee_name' as employee_name,
    coalesce(nullif(btrim(s.item->>'cost_center'),''),'Não informado') as cost_center,
    s.item->>'status' as preview_employee_status,s.item->>'issue' as blocking_issue,
    s.item->'amounts' as amounts
  from public.payroll_employer_charge_previews p
  cross join lateral jsonb_array_elements(p.snapshot) s(item)
),
components as (
  select pp.*,
    c.contribution_key,c.contribution_label,
    coalesce(nullif(pp.amounts->>c.contribution_key,'')::numeric,0)::numeric(14,2) as preview_amount
  from preview_people pp
  cross join lateral (values
    ('employer_inss'::text,'INSS patronal'::text),
    ('rat'::text,'RAT ajustado pelo FAP'::text),
    ('third_parties'::text,'Terceiros'::text),
    ('payroll_pis'::text,'PIS sobre folha'::text),
    ('fgts'::text,'FGTS'::text)
  ) c(contribution_key,contribution_label)
),
processed as (
  select c.organization_id,c.preview_id,c.payroll_run_id,c.payroll_entry_id,c.contribution_key,
    coalesce(sum(i.amount) filter(where c.contribution_key='fgts' and i.code='FGTS_MENSAL'),0)::numeric(14,2) as fgts_amount,
    coalesce(sum(i.amount) filter(where m.status='validated' and m.contribution_key=c.contribution_key),0)::numeric(14,2) as mapped_amount,
    coalesce(sum(i.amount) filter(where m.status='pending' or m.id is null and i.code like 'PARAM_%'),0)::numeric(14,2) as unclassified_amount
  from components c
  left join public.payroll_entry_items i
    on i.organization_id=c.organization_id and i.payroll_entry_id::text=c.payroll_entry_id
    and i.item_type='employer_charge'
  left join public.payroll_employer_charge_component_mappings m
    on m.organization_id=i.organization_id and m.parameter_table_id=i.source_parameter_table_id
  group by c.organization_id,c.preview_id,c.payroll_run_id,c.payroll_entry_id,c.contribution_key
)
select c.organization_id,c.preview_id,c.payroll_run_id,c.competence,c.preview_status,c.calculation_version,
  c.payroll_entry_id,c.employee_id,c.employee_code,c.employee_name,c.cost_center,
  c.preview_employee_status,c.blocking_issue,c.contribution_key,c.contribution_label,
  case when c.contribution_key='fgts' then null else c.preview_amount end as preview_amount,
  case when c.contribution_key='fgts' then p.fgts_amount else p.mapped_amount end as processed_amount,
  p.unclassified_amount,
  case
    when c.preview_status<>'preview' then 'preview_blocked'
    when c.contribution_key='fgts' then 'fgts_processed_only'
    when p.unclassified_amount>0 then 'mapping_pending'
    when abs(p.mapped_amount-c.preview_amount)<=0.01 then 'matched'
    else 'amount_difference'
  end as reconciliation_status,
  case when c.contribution_key='fgts' then null
       else round(p.mapped_amount-c.preview_amount,2) end as difference_amount
from components c
join processed p on p.organization_id=c.organization_id and p.preview_id=c.preview_id
 and p.payroll_entry_id=c.payroll_entry_id and p.contribution_key=c.contribution_key;

grant select on public.payroll_employer_charge_component_reconciliation to authenticated;
comment on view public.payroll_employer_charge_component_reconciliation is
'Conciliação individual por contribuição. Valores PARAM_* só são atribuídos após mapeamento documental validado por segundo responsável. FGTS é exibido separadamente como valor processado, sem comparação com prévia patronal.';
