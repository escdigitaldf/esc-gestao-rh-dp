-- Auditoria de vigência e integridade das tabelas legais e parâmetros patronais.
create or replace view public.payroll_tax_parameter_audit
with (security_invoker = true)
as
with headers as (
  select null::uuid as organization_id,'legal'::text as table_scope,t.id as table_id,t.tax_code as table_code,t.description as table_title,'progressive'::text as calculation_method,t.effective_from,t.effective_to,t.metadata->>'source' as source_reference,t.metadata->>'source_url' as source_url,'registered'::text as table_status,t.metadata,case when t.tax_code in ('FGTS_GENERAL','FGTS_APPRENTICE') then 'scalar' else 'bracketed' end as parameter_shape from public.payroll_tax_tables t
  union all
  select p.organization_id,'organization'::text,p.id,p.table_code,p.title,p.calculation_method,p.effective_from,p.effective_to,p.source_reference,p.source_url,p.status,jsonb_build_object('notes',p.notes),case when p.calculation_method in ('fixed_rate','fixed_amount') then 'single' else 'bracketed' end from public.payroll_parameter_tables p
),
brackets as (
  select 'legal'::text as table_scope,null::uuid as organization_id,b.tax_table_id as table_id,b.bracket_order,b.lower_limit,b.upper_limit,b.rate,b.deduction as deduction_amount,0::numeric as fixed_amount,true as rate_is_fraction from public.payroll_tax_brackets b
  union all
  select 'organization'::text,b.organization_id,b.parameter_table_id,b.bracket_order,b.lower_limit,b.upper_limit,b.rate,b.deduction_amount,b.fixed_amount,false from public.payroll_parameter_brackets b
),
ordered_brackets as (
  select b.*,lag(b.upper_limit) over(partition by b.table_scope,b.organization_id,b.table_id order by b.bracket_order,b.lower_limit) as previous_upper,lag(b.bracket_order) over(partition by b.table_scope,b.organization_id,b.table_id order by b.bracket_order,b.lower_limit) as previous_order,row_number() over(partition by b.table_scope,b.organization_id,b.table_id order by b.bracket_order desc,b.lower_limit desc) as reverse_position from brackets b
),
bracket_summary as (
  select table_scope,organization_id,table_id,count(*)::integer as bracket_count,count(*) filter(where lower_limit<0 or (upper_limit is not null and upper_limit<=lower_limit))::integer as invalid_ranges,count(*) filter(where rate<0 or (rate_is_fraction and rate>1) or (not rate_is_fraction and rate>100))::integer as invalid_rates,count(*) filter(where deduction_amount<0 or fixed_amount<0)::integer as invalid_amounts,count(*) filter(where previous_order is not null and bracket_order<=previous_order)::integer as duplicate_or_unsorted_orders,count(*) filter(where previous_upper is not null and lower_limit>previous_upper)::integer as range_gaps,count(*) filter(where previous_upper is not null and lower_limit<previous_upper)::integer as range_overlaps,max(upper_limit) filter(where reverse_position=1) as final_upper_limit from ordered_brackets group by table_scope,organization_id,table_id
),
versioned as (
  select h.*,count(h2.table_id)::integer as overlapping_effective_versions from headers h left join headers h2 on h2.table_scope=h.table_scope and h2.table_code=h.table_code and h2.organization_id is not distinct from h.organization_id and h2.table_id<>h.table_id and h.effective_from<=coalesce(h2.effective_to,'9999-12-31'::date) and h2.effective_from<=coalesce(h.effective_to,'9999-12-31'::date) group by h.organization_id,h.table_scope,h.table_id,h.table_code,h.table_title,h.calculation_method,h.effective_from,h.effective_to,h.source_reference,h.source_url,h.table_status,h.metadata,h.parameter_shape
),
evaluated as (
  select v.*,coalesce(b.bracket_count,0) as bracket_count,coalesce(b.invalid_ranges,0) as invalid_ranges,coalesce(b.invalid_rates,0) as invalid_rates,coalesce(b.invalid_amounts,0) as invalid_amounts,coalesce(b.duplicate_or_unsorted_orders,0) as duplicate_or_unsorted_orders,coalesce(b.range_gaps,0) as range_gaps,coalesce(b.range_overlaps,0) as range_overlaps,b.final_upper_limit,case when v.table_scope='legal' and v.table_code='INSS_EMPLOYEE' then nullif(v.metadata->>'cap','')::numeric else null end as declared_cap from versioned v left join bracket_summary b on b.table_scope=v.table_scope and b.table_id=v.table_id and b.organization_id is not distinct from v.organization_id
),
findings as (
  select e.*,array_remove(array[
    case when coalesce(trim(e.source_reference),'')='' then 'missing_source_reference' end,
    case when e.table_scope='legal' and coalesce(trim(e.source_url),'')='' then 'missing_source_url' end,
    case when e.effective_to is not null and e.effective_to<e.effective_from then 'invalid_effective_period' end,
    case when e.overlapping_effective_versions>0 then 'overlapping_effective_versions' end,
    case when e.table_scope='organization' and e.table_status not in ('active','validated','draft','inactive') then 'unknown_table_status' end,
    case when e.parameter_shape in ('bracketed','single') and e.bracket_count=0 then 'missing_brackets' end,
    case when e.parameter_shape='single' and e.bracket_count<>1 then 'single_parameter_requires_one_bracket' end,
    case when e.parameter_shape='bracketed' and e.bracket_count>0 and e.final_upper_limit is not null and not(e.table_scope='legal' and e.table_code='INSS_EMPLOYEE') then 'missing_open_ended_final_bracket' end,
    case when e.invalid_ranges>0 then 'invalid_bracket_ranges' end,
    case when e.invalid_rates>0 then 'invalid_bracket_rates' end,
    case when e.invalid_amounts>0 then 'negative_deduction_or_fixed_amount' end,
    case when e.duplicate_or_unsorted_orders>0 then 'duplicate_or_unsorted_bracket_order' end,
    case when e.range_gaps>0 then 'bracket_range_gaps' end,
    case when e.range_overlaps>0 then 'bracket_range_overlaps' end,
    case when e.table_scope='legal' and e.table_code in ('FGTS_GENERAL','FGTS_APPRENTICE') and (nullif(e.metadata->>'rate','') is null or (e.metadata->>'rate')::numeric<=0 or (e.metadata->>'rate')::numeric>1) then 'invalid_scalar_rate' end,
    case when e.table_scope='legal' and e.table_code='INSS_EMPLOYEE' and (e.declared_cap is null or e.final_upper_limit is distinct from e.declared_cap) then 'inss_cap_mismatch' end,
    case when e.table_scope='legal' and e.table_code='IRRF_MONTHLY' and (e.metadata->>'dependent_deduction' is null or e.metadata->>'simplified_deduction' is null or e.metadata->>'reduction_full_until' is null or e.metadata->>'reduction_phaseout_until' is null or e.metadata->>'reduction_fixed' is null or e.metadata->>'reduction_factor' is null) then 'incomplete_irrf_reduction_metadata' end
  ]::text[],null) as issue_codes from evaluated e
)
select organization_id,table_scope,table_id,table_code,table_title,calculation_method,effective_from,effective_to,source_reference,source_url,table_status,metadata,bracket_count,invalid_ranges,invalid_rates,invalid_amounts,duplicate_or_unsorted_orders,range_gaps,range_overlaps,final_upper_limit,declared_cap,issue_codes,cardinality(issue_codes)::integer as issue_count,case when cardinality(issue_codes)>0 then 'review_required' when table_status='inactive' then 'inactive' when table_status='draft' then 'draft' when table_status in ('active','validated') then 'validated_configuration' else 'registered_source' end as audit_status,overlapping_effective_versions from findings;
grant select on public.payroll_tax_parameter_audit to authenticated;