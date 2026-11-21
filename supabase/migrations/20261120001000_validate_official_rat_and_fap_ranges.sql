-- Valida limites legais do FAP e graus de risco RAT no cadastro de lotações.
-- Não define automaticamente FPAS/terceiros: esses enquadramentos continuam
-- dependendo da atividade, da tabela oficial e da evidência documental.

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.organization_payroll_tax_lotations'::regclass
      and conname='organization_payroll_tax_lotations_fap_official_range'
  ) then
    alter table public.organization_payroll_tax_lotations
      add constraint organization_payroll_tax_lotations_fap_official_range
      check (fap_factor between 0.50000 and 2.00000
        and fap_factor = round(fap_factor,4));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.organization_payroll_tax_lotations'::regclass
      and conname='organization_payroll_tax_lotations_rat_risk_grade'
  ) then
    alter table public.organization_payroll_tax_lotations
      add constraint organization_payroll_tax_lotations_rat_risk_grade
      check (rat_rate in (1.00000,2.00000,3.00000));
  end if;
end
$constraints$;

create or replace function public.validate_payroll_tax_lotation()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_regime text;
begin
  new.updated_at := now();

  if new.status = 'validated' then
    perform 1
    from public.organizations o
    where o.id = new.organization_id
    for update;

    select o.tax_regime into v_regime
    from public.organizations o
    where o.id = new.organization_id;

    if v_regime is null or new.tax_regime is distinct from v_regime then
      raise exception 'O regime tributário da lotação deve corresponder ao regime vigente no cadastro da organização.';
    end if;

    if new.fap_factor < 0.50000 or new.fap_factor > 2.00000
      or new.fap_factor <> round(new.fap_factor,4) then
      raise exception 'FAP inválido. Informe o multiplicador oficial do estabelecimento entre 0,5000 e 2,0000, com quatro casas decimais.';
    end if;

    if new.rat_rate not in (1.00000,2.00000,3.00000) then
      raise exception 'RAT inválido. Informe o grau de risco de 1%, 2% ou 3%, conforme o CNAE preponderante e a documentação oficial.';
    end if;

    if new.fpas_source_reference !~ '[[:alnum:]]'
      or new.third_party_source_reference !~ '[[:alnum:]]'
      or new.cnae_rat_source_reference !~ '[[:alnum:]]'
      or new.fap_source_reference !~ '[[:alnum:]]'
      or new.employer_inss_source_reference !~ '[[:alnum:]]' then
      raise exception 'Cada classificação exige sua própria referência documental.';
    end if;

    if new.tax_regime = 'Simples Nacional'
      and (new.simples_annex is null or new.annex_iv_activity is null) then
      raise exception 'No Simples Nacional, informe o anexo e a classificação de atividade desta lotação.';
    end if;

    if new.tax_regime = 'Simples Nacional'
      and (new.simples_annex = 'mixed'
        or new.annex_iv_activity is distinct from (new.simples_annex = 'IV')) then
      raise exception 'A lotação deve representar um único anexo e ter indicação coerente de atividade do Anexo IV.';
    end if;

    if new.tax_regime <> 'Simples Nacional'
      and (new.simples_annex is not null or new.annex_iv_activity is not null) then
      raise exception 'Anexo do Simples não se aplica a este regime tributário.';
    end if;

    if extract(year from new.validity_from)::integer <> new.fap_year
      or new.validity_to is null
      or extract(year from new.validity_to)::integer <> new.fap_year then
      raise exception 'O FAP é anual: a vigência da lotação deve ficar dentro do ano informado para o FAP. Cadastre nova versão para o ano seguinte.';
    end if;

    if exists (
      select 1
      from public.organization_payroll_tax_lotations l
      where l.organization_id = new.organization_id
        and l.lotation_code = new.lotation_code
        and l.id <> coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid)
        and l.status = 'validated'
        and daterange(l.validity_from,coalesce(l.validity_to,'infinity'::date),'[]')
          && daterange(new.validity_from,coalesce(new.validity_to,'infinity'::date),'[]')
    ) then
      raise exception 'Já existe lotação validada com o mesmo código e vigência sobreposta.';
    end if;

    new.validated_by := coalesce(new.validated_by,(select auth.uid()));
    new.validated_at := coalesce(new.validated_at,now());
  else
    new.validated_by := null;
    new.validated_at := null;
  end if;

  return new;
end;
$function$;

comment on constraint organization_payroll_tax_lotations_fap_official_range
  on public.organization_payroll_tax_lotations is
  'FAP oficial do estabelecimento: multiplicador de 0,5000 a 2,0000 com quatro casas decimais.';

comment on constraint organization_payroll_tax_lotations_rat_risk_grade
  on public.organization_payroll_tax_lotations is
  'Graus de risco RAT de 1%, 2% ou 3%; o enquadramento depende do CNAE preponderante e da regra oficial aplicável.';
