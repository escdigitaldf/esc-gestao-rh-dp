-- Etapa 5: identifica a natureza da folha e prepara o fator anual do 13º
-- Sem alterar folhas existentes: todas recebem payroll_type='monthly'.
alter table public.payroll_runs add column if not exists payroll_type text not null default 'monthly';
alter table public.payroll_runs drop constraint if exists payroll_runs_payroll_type_check;
alter table public.payroll_runs add constraint payroll_runs_payroll_type_check check (payroll_type in ('monthly','thirteenth_salary','termination','thirteenth_termination'));
comment on column public.payroll_runs.payroll_type is 'Natureza da folha: mensal, 13º anual, rescisão ou 13º pago em rescisão.';
create index if not exists payroll_runs_org_type_competence_idx on public.payroll_runs(organization_id, payroll_type, reference_month);
create or replace function public.get_simples_annex_iv_concomitance_factor(p_organization_id uuid,p_competence date,p_payroll_type text)
returns table (factor numeric(12,8),annex_iv_revenue numeric(16,2),total_gross_revenue numeric(16,2),period_start date,period_end date,months_validated integer)
language plpgsql security invoker set search_path = ''
as $function$
declare v_start date; v_end date; v_months integer; v_annex numeric(16,2); v_total numeric(16,2);
begin
 if p_organization_id is null or p_competence is null or p_payroll_type is null then raise exception 'Organização, competência e tipo de folha são obrigatórios.'; end if;
 if p_payroll_type not in ('monthly','thirteenth_salary','termination','thirteenth_termination') then raise exception 'Tipo de folha inválido.'; end if;
 if p_payroll_type='thirteenth_salary' then
  if extract(month from p_competence)<>12 then raise exception 'A folha anual do 13º deve ter competência dezembro.'; end if;
  v_start := (date_trunc('year',p_competence)::date - interval '1 month')::date;
  v_end := (date_trunc('year',p_competence)::date - interval '1 day')::date;
 else
  v_start := date_trunc('month',p_competence)::date;
  v_end := (v_start + interval '1 month - 1 day')::date;
 end if;
 select count(*)::integer,coalesce(sum(r.annex_iv_gross_revenue),0)::numeric(16,2),coalesce(sum(r.total_gross_revenue),0)::numeric(16,2)
 into v_months,v_annex,v_total from public.organization_payroll_activity_revenue r
 where r.organization_id=p_organization_id and r.status='validated'
 and r.competence between date_trunc('month',v_start)::date and date_trunc('month',v_end)::date;
 if v_months<>12 and p_payroll_type='thirteenth_salary' then raise exception 'Fator anual do 13º indisponível: são necessárias 12 competências mensais validadas entre % e %; encontradas %.',v_start,v_end,v_months; end if;
 if v_months<>1 and p_payroll_type<>'thirteenth_salary' then raise exception 'Fator mensal indisponível: informe e valide a receita da competência %.',v_start; end if;
 if v_total=0 then if v_annex<>0 then raise exception 'Receita Anexo IV não pode existir quando a receita total é zero.'; end if; factor:=0; else factor:=round(v_annex/v_total,8); end if;
 annex_iv_revenue:=v_annex; total_gross_revenue:=v_total; period_start:=v_start; period_end:=v_end; months_validated:=v_months; return next;
end;
$function$;
revoke all on function public.get_simples_annex_iv_concomitance_factor(uuid,date,text) from public,anon;
grant execute on function public.get_simples_annex_iv_concomitance_factor(uuid,date,text) to authenticated;
comment on function public.get_simples_annex_iv_concomitance_factor(uuid,date,text) is 'Calcula fator de concomitância mensal ou anual do 13º com exigência de receita documental validada para todos os meses do período. Requer integração explícita ao motor de prévia antes de uso operacional.';