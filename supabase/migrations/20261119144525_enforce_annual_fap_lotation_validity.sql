
create or replace function public.validate_payroll_tax_lotation()
returns trigger language plpgsql set search_path='' as $$
declare v_regime text;
begin
 new.updated_at:=now();
 if new.status='validated' then
  perform 1 from public.organizations o where o.id=new.organization_id for update;
  select o.tax_regime into v_regime from public.organizations o where o.id=new.organization_id;
  if v_regime is null or new.tax_regime is distinct from v_regime then raise exception 'O regime tributário da lotação deve corresponder ao regime vigente no cadastro da organização.'; end if;
  if new.fpas_source_reference !~ '[[:alnum:]]' or new.third_party_source_reference !~ '[[:alnum:]]' or new.cnae_rat_source_reference !~ '[[:alnum:]]' or new.fap_source_reference !~ '[[:alnum:]]' or new.employer_inss_source_reference !~ '[[:alnum:]]' then raise exception 'Cada classificação exige sua própria referência documental.'; end if;
  if new.tax_regime='Simples Nacional' and (new.simples_annex is null or new.annex_iv_activity is null) then raise exception 'No Simples Nacional, informe o anexo e a classificação de atividade desta lotação.'; end if;
  if new.tax_regime='Simples Nacional' and (new.simples_annex='mixed' or new.annex_iv_activity is distinct from (new.simples_annex='IV')) then raise exception 'A lotação deve representar um único anexo e ter indicação coerente de atividade do Anexo IV.'; end if;
  if new.tax_regime<>'Simples Nacional' and (new.simples_annex is not null or new.annex_iv_activity is not null) then raise exception 'Anexo do Simples não se aplica a este regime tributário.'; end if;
  if extract(year from new.validity_from)::integer<>new.fap_year or new.validity_to is null or extract(year from new.validity_to)::integer<>new.fap_year then raise exception 'O FAP é anual: informe a vigência dentro do mesmo ano do FAP e encerre o registro em 31/12. Cadastre nova versão para o ano seguinte.'; end if;
  if exists(select 1 from public.organization_payroll_tax_lotations l where l.organization_id=new.organization_id and l.lotation_code=new.lotation_code and l.id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid) and l.status='validated' and daterange(l.validity_from,coalesce(l.validity_to,'infinity'::date),'[]') && daterange(new.validity_from,coalesce(new.validity_to,'infinity'::date),'[]')) then raise exception 'Já existe lotação validada com o mesmo código e vigência sobreposta.'; end if;
  new.validated_by:=coalesce(new.validated_by,(select auth.uid())); new.validated_at:=coalesce(new.validated_at,now());
 else new.validated_by:=null; new.validated_at:=null; end if;
 return new;
end $$;
