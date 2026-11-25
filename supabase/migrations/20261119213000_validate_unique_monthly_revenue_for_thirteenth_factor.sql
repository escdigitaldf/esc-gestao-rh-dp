-- Exige exatamente uma receita validada por competência mensal no fator anual do 13º.
-- A unicidade atual por data não impede registros em dias diferentes do mesmo mês.
create or replace function public.get_simples_annex_iv_concomitance_factor(
  p_organization_id uuid,
  p_competence date,
  p_payroll_type text
)
returns table (
  factor numeric(12,8),
  annex_iv_revenue numeric(16,2),
  total_gross_revenue numeric(16,2),
  period_start date,
  period_end date,
  months_validated integer
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_start date;
  v_end date;
  v_months integer;
  v_rows integer;
  v_annex numeric(16,2);
  v_total numeric(16,2);
begin
  if p_organization_id is null or p_competence is null or p_payroll_type is null then
    raise exception 'Organização, competência e tipo de folha são obrigatórios.';
  end if;
  if p_payroll_type not in ('monthly','thirteenth_salary','termination','thirteenth_termination') then
    raise exception 'Tipo de folha inválido.';
  end if;

  if p_payroll_type = 'thirteenth_salary' then
    if extract(month from p_competence) <> 12 then
      raise exception 'A folha anual do 13º deve ter competência dezembro.';
    end if;
    v_end := (date_trunc('month',p_competence)::date - interval '1 day')::date;
    v_start := (date_trunc('month',v_end)::date - interval '11 months')::date;
  else
    v_start := date_trunc('month',p_competence)::date;
    v_end := (v_start + interval '1 month - 1 day')::date;
  end if;

  select
    count(*)::integer,
    count(distinct date_trunc('month',r.competence))::integer,
    coalesce(sum(r.annex_iv_gross_revenue),0)::numeric(16,2),
    coalesce(sum(r.total_gross_revenue),0)::numeric(16,2)
  into v_rows,v_months,v_annex,v_total
  from public.organization_payroll_activity_revenue r
  where r.organization_id=p_organization_id
    and r.status='validated'
    and r.competence between v_start and v_end;

  if p_payroll_type = 'thirteenth_salary' then
    if v_rows <> 12 or v_months <> 12 then
      raise exception 'Fator anual do 13º indisponível: é necessária exatamente uma receita validada para cada uma das 12 competências entre % e %. Registros: %; competências distintas: %.',
        v_start,v_end,v_rows,v_months;
    end if;
  else
    if v_rows <> 1 or v_months <> 1 then
      raise exception 'Fator mensal indisponível: é necessária exatamente uma receita validada para a competência %.',
        v_start;
    end if;
  end if;

  if v_total = 0 then
    if v_annex <> 0 then
      raise exception 'Receita Anexo IV não pode existir quando a receita total é zero.';
    end if;
    factor := 0;
  else
    if v_annex > v_total then
      raise exception 'Receita do Anexo IV não pode superar a receita bruta total do período.';
    end if;
    factor := round(v_annex/v_total,8);
  end if;

  annex_iv_revenue := v_annex;
  total_gross_revenue := v_total;
  period_start := v_start;
  period_end := v_end;
  months_validated := v_months;
  return next;
end;
$function$;

comment on function public.get_simples_annex_iv_concomitance_factor(uuid,date,text) is
  'Calcula fator mensal ou anual do 13º. Para o 13º, usa dezembro do ano anterior a novembro do ano de referência e exige exatamente um registro validado em cada competência mensal, sem duplicidade intramês.';
