-- Unifica a apuração do fator de concomitância mensal e anual no motor de encargos.
-- A função auxiliar valida cardinalidade, competências e consistência das receitas.
do $patch$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  v_definition := pg_get_functiondef('public.preview_payroll_employer_charges(uuid)'::regprocedure);

  v_old := '          if v_payroll_type = ''thirteenth_salary'' then'
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

  v_new := '          begin'
        || E'\n' || '            select f.factor, f.annex_iv_revenue, f.total_gross_revenue'
        || E'\n' || '              into v_factor, v_annex_iv_revenue, v_total_gross_revenue'
        || E'\n' || '            from public.get_simples_annex_iv_concomitance_factor(v_org,v_competence,v_payroll_type) f;'
        || E'\n' || '          exception when others then'
        || E'\n' || '            v_factor := 0;'
        || E'\n' || '            v_annex_iv_revenue := 0;'
        || E'\n' || '            v_total_gross_revenue := 0;'
        || E'\n' || '            v_issue := ''Fator de concomitância não validado: '' || SQLERRM;'
        || E'\n' || '          end;';

  if position(v_old in v_definition)=0 then
    raise exception 'Não foi possível localizar o bloco de cálculo mensal/anual do fator de concomitância. Migração cancelada sem alteração.';
  end if;

  v_definition := replace(v_definition,v_old,v_new);
  execute v_definition;
end;
$patch$;

comment on function public.preview_payroll_employer_charges(uuid) is
  'Gera prévia versionada e bloqueável de encargos patronais. O fator de concomitância mensal, anual do 13º e mensal de rescisão é obtido por função única com validação documental e de consistência da receita.';
