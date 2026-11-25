-- Etapa 5: proporcionalidade legal do 13º para remuneração mensal fixa
-- Regra geral: 1/12 por mês com pelo menos 15 dias de vínculo no mês.
-- Não contempla variáveis, intermitente, afastamentos com regras próprias ou médias.
create or replace function public.calculate_fixed_monthly_thirteenth(
  p_monthly_salary numeric,
  p_admission_date date,
  p_termination_date date,
  p_year integer
)
returns table (eligible_months integer, thirteenth_amount numeric(14,2), monthly_credits jsonb)
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_month integer;
  v_start date;
  v_end date;
  v_days integer;
  v_eligible integer := 0;
  v_credits jsonb := '[]'::jsonb;
begin
  if p_monthly_salary is null or p_monthly_salary < 0 then
    raise exception 'Salário mensal deve ser informado e não pode ser negativo.';
  end if;
  if p_admission_date is null or p_year < 1900 or p_year > 9999 then
    raise exception 'Data de admissão e ano de referência são obrigatórios.';
  end if;
  if p_termination_date is not null and p_termination_date < p_admission_date then
    raise exception 'Data de desligamento anterior à admissão.';
  end if;

  for v_month in 1..12 loop
    v_start := make_date(p_year,v_month,1);
    v_end := (v_start + interval '1 month - 1 day')::date;
    v_start := greatest(v_start,p_admission_date);
    if p_termination_date is not null then v_end := least(v_end,p_termination_date); end if;
    v_days := case when v_end < v_start then 0 else (v_end-v_start)+1 end;
    if v_days >= 15 then
      v_eligible := v_eligible + 1;
      v_credits := v_credits || jsonb_build_array(jsonb_build_object('month',v_month,'days_in_contract',v_days,'eligible',true));
    else
      v_credits := v_credits || jsonb_build_array(jsonb_build_object('month',v_month,'days_in_contract',v_days,'eligible',false));
    end if;
  end loop;

  eligible_months := v_eligible;
  thirteenth_amount := round(p_monthly_salary * v_eligible / 12,2);
  monthly_credits := v_credits;
  return next;
end;
$function$;

revoke all on function public.calculate_fixed_monthly_thirteenth(numeric,date,date,integer) from public,anon;
grant execute on function public.calculate_fixed_monthly_thirteenth(numeric,date,date,integer) to authenticated;
comment on function public.calculate_fixed_monthly_thirteenth(numeric,date,date,integer) is
  'Calcula 13º proporcional de remuneração mensal fixa por avos de meses com pelo menos 15 dias de vínculo. Não calcula médias/variáveis nem situações especiais; requer revisão do DP.';

-- Integra o fator anual do 13º ao motor de prévia de encargos do Anexo IV.
-- A função original é preservada e alterada apenas nos pontos de leitura do tipo
-- de folha e obtenção da receita de concomitância.
do $patch$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  v_definition := pg_get_functiondef('public.preview_payroll_employer_charges(uuid)'::regprocedure);

  v_old := '  v_competence date;'
        || E'\n' || '  v_month_end date;';
  v_new := '  v_competence date;'
        || E'\n' || '  v_month_end date;'
        || E'\n' || '  v_payroll_type text;';
  if position(v_old in v_definition)=0 then raise exception 'Não foi possível localizar declaração de competência no motor de encargos.'; end if;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := '  select r.organization_id, date_trunc(''month'', r.reference_month)::date'
        || E'\n' || '    into v_org, v_competence'
        || E'\n' || '  from public.payroll_runs r where r.id = p_payroll_run_id;';
  v_new := '  select r.organization_id, date_trunc(''month'', r.reference_month)::date, r.payroll_type'
        || E'\n' || '    into v_org, v_competence, v_payroll_type'
        || E'\n' || '  from public.payroll_runs r where r.id = p_payroll_run_id;';
  if position(v_old in v_definition)=0 then raise exception 'Não foi possível localizar leitura do tipo de folha no motor de encargos.'; end if;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := '          select count(*)::integer into v_revenue_count'
        || E'\n' || '          from public.organization_payroll_activity_revenue rev'
        || E'\n' || '          where rev.organization_id=v_org and rev.competence=v_competence and rev.status=''validated'';'
        || E'\n' || '          if v_revenue_count <> 1 then'
        || E'\n' || '            v_issue := ''Receita mensal do Anexo IV ainda não foi informada e validada para a competência.'';'
        || E'\n' || '          else'
        || E'\n' || '            select rev.annex_iv_gross_revenue, rev.total_gross_revenue'
        || E'\n' || '              into v_annex_iv_revenue, v_total_gross_revenue'
        || E'\n' || '            from public.organization_payroll_activity_revenue rev'
        || E'\n' || '            where rev.organization_id=v_org and rev.competence=v_competence and rev.status=''validated'' limit 1;'
        || E'\n' || '            if v_total_gross_revenue=0 then v_factor := 0;'
        || E'\n' || '            else v_factor := v_annex_iv_revenue / v_total_gross_revenue;'
        || E'\n' || '            end if;'
        || E'\n' || '          end if;';
  v_new := '          if v_payroll_type = ''thirteenth_salary'' then'
        || E'\n' || '            select f.factor, f.annex_iv_revenue, f.total_gross_revenue'
        || E'\n' || '              into v_factor, v_annex_iv_revenue, v_total_gross_revenue'
        || E'\n' || '            from public.get_simples_annex_iv_concomitance_factor(v_org,v_competence,v_payroll_type) f;'
        || E'\n' || '          else'
        || E'\n' || '            select count(*)::integer into v_revenue_count'
        || E'\n' || '            from public.organization_payroll_activity_revenue rev'
        || E'\n' || '            where rev.organization_id=v_org and rev.competence=v_competence and rev.status=''validated'';'
        || E'\n' || '            if v_revenue_count <> 1 then'
        || E'\n' || '              v_issue := ''Receita mensal do Anexo IV ainda não foi informada e validada para a competência.'';'
        || E'\n' || '            else'
        || E'\n' || '              select rev.annex_iv_gross_revenue, rev.total_gross_revenue'
        || E'\n' || '                into v_annex_iv_revenue, v_total_gross_revenue'
        || E'\n' || '              from public.organization_payroll_activity_revenue rev'
        || E'\n' || '              where rev.organization_id=v_org and rev.competence=v_competence and rev.status=''validated'' limit 1;'
        || E'\n' || '              if v_total_gross_revenue=0 then v_factor := 0;'
        || E'\n' || '              else v_factor := v_annex_iv_revenue / v_total_gross_revenue;'
        || E'\n' || '              end if;'
        || E'\n' || '            end if;'
        || E'\n' || '          end if;';
  if position(v_old in v_definition)=0 then raise exception 'Não foi possível localizar bloco de receita concomitante no motor de encargos.'; end if;
  v_definition := replace(v_definition,v_old,v_new);

  execute v_definition;
end;
$patch$;
