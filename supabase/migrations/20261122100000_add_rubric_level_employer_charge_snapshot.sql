-- Add immutable rubric-level traceability to future employer-charge previews.
-- Existing previews are intentionally left unchanged: they cannot be reconstructed
-- safely from current rubric rules or current employee master data.

do $$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('public.preview_payroll_employer_charges(uuid)'::regprocedure)
    into v_definition;

  v_old := E'      ''status'',v_status,''issue'',v_issue';
  v_new := E'      ''normative_sources'',jsonb_build_object(\n'
    || E'        ''employer_inss'',v_lotation.employer_inss_source_reference,\n'
    || E'        ''rat_cnae'',v_lotation.cnae_rat_source_reference,\n'
    || E'        ''fap'',v_lotation.fap_source_reference,\n'
    || E'        ''fpas'',v_lotation.fpas_source_reference,\n'
    || E'        ''third_parties'',v_lotation.third_party_source_reference,\n'
    || E'        ''source_url'',v_lotation.source_url\n'
    || E'      ),\n'
    || E'      ''rubric_details'',(\n'
    || E'        select coalesce(jsonb_agg(jsonb_build_object(\n'
    || E'          ''item_id'',i.id,\n'
    || E'          ''rubric_id'',i.rubric_id,\n'
    || E'          ''code'',i.code,\n'
    || E'          ''description'',i.description,\n'
    || E'          ''item_type'',i.item_type,\n'
    || E'          ''amount'',i.amount,\n'
    || E'          ''affects_employer_inss'',i.affects_employer_inss,\n'
    || E'          ''affects_rat'',i.affects_rat,\n'
    || E'          ''affects_third_parties'',i.affects_third_parties,\n'
    || E'          ''affects_payroll_pis'',i.affects_payroll_pis,\n'
    || E'          ''source_parameter_table_id'',i.source_parameter_table_id,\n'
    || E'          ''payroll_variable_event_id'',i.payroll_variable_event_id\n'
    || E'        ) order by i.code,i.id),''[]''::jsonb)\n'
    || E'        from public.payroll_entry_items i\n'
    || E'        where i.organization_id=v_org and i.payroll_entry_id=v_entry.id\n'
    || E'      ),\n'
    || E'      ''status'',v_status,''issue'',v_issue';

  if position(v_old in v_definition) = 0 then
    raise exception 'Não foi possível localizar o bloco de status do snapshot patronal; migração interrompida sem alteração.';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end $$;

create or replace view public.payroll_employer_charge_preview_rubric_details
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
  s.item->>'employee_id' as employee_id,
  s.item->>'employee_code' as employee_code,
  s.item->>'employee_name' as employee_name,
  coalesce(nullif(btrim(s.item->>'cost_center'),''),'Não informado') as cost_center,
  s.item->>'lotation_id' as lotation_id,
  s.item->>'lotation_code' as lotation_code,
  s.item->>'fpas_code' as fpas_code,
  s.item->>'third_party_code' as third_party_code,
  s.item->>'tax_regime' as tax_regime,
  s.item->>'simples_annex' as simples_annex,
  nullif(s.item->>'fap_year','')::integer as fap_year,
  nullif(s.item->>'fap_factor','')::numeric as fap_factor,
  nullif(s.item->>'annex_iv_factor','')::numeric as annex_iv_factor,
  s.item->>'status' as employee_calculation_status,
  s.item->>'issue' as blocking_issue,
  s.item->'normative_sources' as normative_sources,
  r.item->>'item_id' as payroll_item_id,
  r.item->>'rubric_id' as rubric_id,
  r.item->>'code' as rubric_code,
  r.item->>'description' as rubric_description,
  r.item->>'item_type' as item_type,
  coalesce(nullif(r.item->>'amount','')::numeric,0) as rubric_amount,
  c.contribution_key,
  c.contribution_label,
  coalesce(nullif(s.item->'rates'->>c.rate_key,'')::numeric,0) as applied_rate,
  case when coalesce((r.item->>c.incidence_key)::boolean,false)
       then coalesce(nullif(r.item->>'amount','')::numeric,0) else 0 end as calculation_base,
  case when s.item->>'status'='calculated'
         and coalesce((r.item->>c.incidence_key)::boolean,false)
       then round(coalesce(nullif(r.item->>'amount','')::numeric,0)
         * coalesce(nullif(s.item->'rates'->>c.rate_key,'')::numeric,0) / 100,2)
       else null end as rubric_calculated_amount,
  r.item->>'source_parameter_table_id' as source_parameter_table_id,
  r.item->>'payroll_variable_event_id' as payroll_variable_event_id,
  coalesce((r.item->>c.incidence_key)::boolean,false) as incidence_applied
from public.payroll_employer_charge_previews p
cross join lateral jsonb_array_elements(p.snapshot) as s(item)
cross join lateral jsonb_array_elements(coalesce(s.item->'rubric_details','[]'::jsonb)) as r(item)
cross join lateral (
  values
    ('employer_inss'::text,'INSS patronal'::text,'affects_employer_inss'::text,'employer_inss'::text),
    ('rat'::text,'RAT ajustado pelo FAP'::text,'affects_rat'::text,'rat_adjusted'::text),
    ('third_parties'::text,'Terceiros'::text,'affects_third_parties'::text,'third_parties'::text),
    ('payroll_pis'::text,'PIS sobre folha'::text,'affects_payroll_pis'::text,'payroll_pis'::text)
) as c(contribution_key,contribution_label,incidence_key,rate_key)
where lower(coalesce(r.item->>'item_type',''))='earning'
  and coalesce((r.item->>c.incidence_key)::boolean,false);

grant select on public.payroll_employer_charge_preview_rubric_details to authenticated;

comment on view public.payroll_employer_charge_preview_rubric_details is
'Memória por rubrica e contribuição baseada exclusivamente no snapshot imutável da prévia. Valores de linha são arredondados individualmente e podem apresentar diferença residual de centavos frente ao total calculado sobre a base agregada do colaborador. Fundamentos documentais são os registrados na lotação no momento da prévia. Prévia antiga sem rubric_details não é reconstruída.';
