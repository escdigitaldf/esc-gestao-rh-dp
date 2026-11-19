-- Preserve the employee cost-center label in each immutable employer-charge preview
-- and expose a normalized detail view for audit/reporting by employee and cost center.

do $$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('public.preview_payroll_employer_charges(uuid)'::regprocedure)
    into v_definition;

  v_old := '  v_entry record;';
  v_new := '  v_entry record;
  v_cost_center text;';
  if position(v_old in v_definition) = 0 then
    raise exception 'Não foi possível localizar a declaração de v_entry para incluir o centro de custo.';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := E'  loop\n    v_issue := null;';
  v_new := E'  loop\n    select coalesce(nullif(btrim(e.cost_center), ''''), ''Não informado'')\n      into v_cost_center\n    from public.employees e\n    where e.id = v_entry.employee_id and e.organization_id = v_org;\n\n    v_issue := null;';
  if position(v_old in v_definition) = 0 then
    raise exception 'Não foi possível localizar o início do loop de colaboradores.';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := E'      ''employee_code'',v_entry.employee_code,''employee_name'',v_entry.employee_name,';
  v_new := E'      ''employee_code'',v_entry.employee_code,''employee_name'',v_entry.employee_name,\n      ''cost_center'',coalesce(v_cost_center, ''Não informado''),';
  if position(v_old in v_definition) = 0 then
    raise exception 'Não foi possível localizar o snapshot do colaborador para incluir centro de custo.';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  execute v_definition;
end $$;

create or replace view public.payroll_employer_charge_preview_details
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
  coalesce(nullif(btrim(s.item->>'cost_center'), ''), 'Não informado') as cost_center,
  s.item->>'employee_id' as employee_id,
  s.item->>'employee_code' as employee_code,
  s.item->>'employee_name' as employee_name,
  s.item->>'lotation_id' as lotation_id,
  s.item->>'lotation_code' as lotation_code,
  s.item->>'tax_regime' as tax_regime,
  s.item->>'simples_annex' as simples_annex,
  s.item->>'fpas_code' as fpas_code,
  s.item->>'third_party_code' as third_party_code,
  s.item->>'status' as employee_calculation_status,
  s.item->>'issue' as blocking_issue,
  c.contribution_key,
  c.contribution_label,
  coalesce(nullif(s.item->'bases'->>c.contribution_key, '')::numeric, 0) as calculation_base,
  coalesce(nullif(s.item->'rates'->>c.rate_key, '')::numeric, 0) as applied_rate,
  coalesce(nullif(s.item->'amounts'->>c.contribution_key, '')::numeric, 0) as calculated_amount
from public.payroll_employer_charge_previews p
cross join lateral jsonb_array_elements(p.snapshot) as s(item)
cross join lateral (
  values
    ('employer_inss'::text, 'INSS patronal'::text, 'employer_inss'::text),
    ('rat'::text, 'RAT ajustado pelo FAP'::text, 'rat_adjusted'::text),
    ('third_parties'::text, 'Terceiros'::text, 'third_parties'::text),
    ('payroll_pis'::text, 'PIS sobre folha'::text, 'payroll_pis'::text)
) as c(contribution_key, contribution_label, rate_key);

grant select on public.payroll_employer_charge_preview_details to authenticated;

create index if not exists payroll_employer_charge_previews_org_competence_idx
  on public.payroll_employer_charge_previews (organization_id, competence desc, created_at desc);
