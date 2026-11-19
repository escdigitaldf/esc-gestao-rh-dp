-- Employer tax framework and incidence audit. No payroll values are recalculated.
create table if not exists public.organization_payroll_employer_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tax_regime text not null,
  simples_annex text,
  annex_iv_activity boolean,
  fpas_code text not null,
  third_party_code text not null,
  rat_rate numeric(8,5) not null check (rat_rate >= 0 and rat_rate <= 100),
  fap_factor numeric(8,5) not null check (fap_factor >= 0 and fap_factor <= 10),
  employer_inss_rate numeric(8,5) not null check (employer_inss_rate >= 0 and employer_inss_rate <= 100),
  third_party_rate numeric(8,5) not null check (third_party_rate >= 0 and third_party_rate <= 100),
  pis_applicable boolean not null,
  pis_rate numeric(8,5) not null check (pis_rate >= 0 and pis_rate <= 100),
  employer_inss_substitution text not null,
  validity_from date not null,
  validity_to date,
  source_reference text not null,
  source_url text,
  status text not null default 'pending' check (status in ('pending','validated','inactive')),
  notes text,
  created_by uuid default auth.uid(),
  validated_by uuid,
  validated_at timestamptz,
  validation_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_payroll_employer_settings_period_chk check (validity_to is null or validity_to >= validity_from),
  constraint organization_payroll_employer_settings_pis_rate_chk check (pis_applicable or pis_rate = 0)
);

create index if not exists org_payroll_employer_settings_org_period_idx
  on public.organization_payroll_employer_settings (organization_id, validity_from, validity_to, status);

alter table public.payroll_rubrics
  add column if not exists affects_employer_inss boolean,
  add column if not exists affects_rat boolean,
  add column if not exists affects_third_parties boolean,
  add column if not exists affects_payroll_pis boolean;

alter table public.payroll_entry_items
  add column if not exists affects_employer_inss boolean,
  add column if not exists affects_rat boolean,
  add column if not exists affects_third_parties boolean,
  add column if not exists affects_payroll_pis boolean;

alter table public.organization_payroll_employer_settings enable row level security;

drop policy if exists organization_payroll_employer_settings_select on public.organization_payroll_employer_settings;
create policy organization_payroll_employer_settings_select
on public.organization_payroll_employer_settings for select to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = organization_payroll_employer_settings.organization_id
    and m.user_id = (select auth.uid()) and m.status = 'active'
));

drop policy if exists organization_payroll_employer_settings_write on public.organization_payroll_employer_settings;
create policy organization_payroll_employer_settings_write
on public.organization_payroll_employer_settings for all to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = organization_payroll_employer_settings.organization_id
    and m.user_id = (select auth.uid()) and m.status = 'active'
    and m.role = any(array['owner','admin','hr_manager','payroll'])
))
with check (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = organization_payroll_employer_settings.organization_id
    and m.user_id = (select auth.uid()) and m.status = 'active'
    and m.role = any(array['owner','admin','hr_manager','payroll'])
));

create or replace function public.validate_payroll_employer_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status = 'validated' then
    if nullif(trim(new.tax_regime), '') is null
      or nullif(trim(new.fpas_code), '') is null
      or nullif(trim(new.third_party_code), '') is null
      or nullif(trim(new.employer_inss_substitution), '') is null
      or nullif(trim(new.source_reference), '') is null then
      raise exception 'Para validar o enquadramento, informe regime, FPAS, código de terceiros, tratamento da contribuição patronal e fundamento documental.';
    end if;
    if new.tax_regime = 'Simples Nacional' and nullif(trim(coalesce(new.simples_annex,'')), '') is null then
      raise exception 'Informe o anexo do Simples Nacional antes de validar o enquadramento.';
    end if;
    if new.tax_regime = 'Simples Nacional' and new.annex_iv_activity is null then
      raise exception 'Informe expressamente se há atividade enquadrada no Anexo IV.';
    end if;
    if new.validated_by is null then new.validated_by := auth.uid(); end if;
    if new.validated_at is null then new.validated_at := now(); end if;
  else
    new.validated_by := null;
    new.validated_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_payroll_employer_settings_trigger on public.organization_payroll_employer_settings;
create trigger validate_payroll_employer_settings_trigger
before insert or update on public.organization_payroll_employer_settings
for each row execute function public.validate_payroll_employer_settings();

create or replace view public.payroll_employer_charge_audit
with (security_invoker = true)
as
with item_summary as (
  select i.organization_id, i.payroll_entry_id,
    count(*)::integer as item_count,
    count(*) filter (where lower(i.item_type) = 'earning' and (
      i.affects_employer_inss is null or i.affects_rat is null or
      i.affects_third_parties is null or i.affects_payroll_pis is null
    ))::integer as earnings_with_unclassified_employer_incidence,
    coalesce(sum(i.amount) filter (where lower(i.item_type) = 'earning' and i.affects_employer_inss is true),0)::numeric(14,2) as employer_inss_incident_amount,
    coalesce(sum(i.amount) filter (where lower(i.item_type) = 'earning' and i.affects_rat is true),0)::numeric(14,2) as rat_incident_amount,
    coalesce(sum(i.amount) filter (where lower(i.item_type) = 'earning' and i.affects_third_parties is true),0)::numeric(14,2) as third_parties_incident_amount,
    coalesce(sum(i.amount) filter (where lower(i.item_type) = 'earning' and i.affects_payroll_pis is true),0)::numeric(14,2) as payroll_pis_incident_amount
  from public.payroll_entry_items i
  group by i.organization_id, i.payroll_entry_id
)
select r.organization_id, r.id as payroll_run_id, r.reference_month as competence,
  r.status as payroll_run_status, e.id as payroll_entry_id, e.employee_id,
  e.employee_code, e.employee_name, e.status as payroll_entry_status,
  coalesce(s.config_count,0)::integer as applicable_config_count,
  s.config_status, s.tax_regime, s.simples_annex, s.annex_iv_activity,
  s.fpas_code, s.third_party_code, s.rat_rate, s.fap_factor,
  s.employer_inss_rate, s.third_party_rate, s.pis_applicable, s.pis_rate,
  s.employer_inss_substitution, s.source_reference,
  coalesce(i.item_count,0)::integer as item_count,
  coalesce(i.earnings_with_unclassified_employer_incidence,0)::integer as earnings_with_unclassified_employer_incidence,
  coalesce(i.employer_inss_incident_amount,0)::numeric(14,2) as employer_inss_incident_amount,
  coalesce(i.rat_incident_amount,0)::numeric(14,2) as rat_incident_amount,
  coalesce(i.third_parties_incident_amount,0)::numeric(14,2) as third_parties_incident_amount,
  coalesce(i.payroll_pis_incident_amount,0)::numeric(14,2) as payroll_pis_incident_amount,
  case
    when coalesce(s.config_count,0) = 0 then 'missing_validated_employer_configuration'
    when s.config_count > 1 then 'overlapping_validated_employer_configurations'
    when coalesce(i.earnings_with_unclassified_employer_incidence,0) > 0 then 'rubric_employer_incidence_unclassified'
    else 'review_required_no_automatic_calculation'
  end as audit_status
from public.payroll_runs r
join public.payroll_entries e on e.payroll_run_id = r.id and e.organization_id = r.organization_id
left join item_summary i on i.payroll_entry_id = e.id and i.organization_id = e.organization_id
left join lateral (
  select count(*)::integer as config_count,
    (array_agg(c.status order by c.created_at desc))[1] as config_status,
    (array_agg(c.tax_regime order by c.created_at desc))[1] as tax_regime,
    (array_agg(c.simples_annex order by c.created_at desc))[1] as simples_annex,
    (array_agg(c.annex_iv_activity order by c.created_at desc))[1] as annex_iv_activity,
    (array_agg(c.fpas_code order by c.created_at desc))[1] as fpas_code,
    (array_agg(c.third_party_code order by c.created_at desc))[1] as third_party_code,
    (array_agg(c.rat_rate order by c.created_at desc))[1] as rat_rate,
    (array_agg(c.fap_factor order by c.created_at desc))[1] as fap_factor,
    (array_agg(c.employer_inss_rate order by c.created_at desc))[1] as employer_inss_rate,
    (array_agg(c.third_party_rate order by c.created_at desc))[1] as third_party_rate,
    (array_agg(c.pis_applicable order by c.created_at desc))[1] as pis_applicable,
    (array_agg(c.pis_rate order by c.created_at desc))[1] as pis_rate,
    (array_agg(c.employer_inss_substitution order by c.created_at desc))[1] as employer_inss_substitution,
    (array_agg(c.source_reference order by c.created_at desc))[1] as source_reference
  from public.organization_payroll_employer_settings c
  where c.organization_id = r.organization_id and c.status = 'validated'
    and c.validity_from <= r.reference_month
    and (c.validity_to is null or c.validity_to >= r.reference_month)
) s on true;

grant select on public.payroll_employer_charge_audit to authenticated;
