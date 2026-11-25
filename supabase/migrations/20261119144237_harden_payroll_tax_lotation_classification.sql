
create or replace function public.validate_payroll_tax_lotation()
returns trigger language plpgsql set search_path='' as $$
declare v_regime text;
begin
 new.updated_at:=now();
 if new.status='validated' then
  perform 1 from public.organizations o where o.id=new.organization_id for update;
  select o.tax_regime into v_regime from public.organizations o where o.id=new.organization_id;
  if v_regime is null or nullif(trim(v_regime),'') is null then raise exception 'Defina o regime tributário da organização antes de validar a lotação.'; end if;
  if new.fpas_source_reference !~ '[[:alnum:]]' or new.third_party_source_reference !~ '[[:alnum:]]'
    or new.cnae_rat_source_reference !~ '[[:alnum:]]' or new.fap_source_reference !~ '[[:alnum:]]'
    or new.employer_inss_source_reference !~ '[[:alnum:]]' then
    raise exception 'Cada classificação exige sua própria referência documental.';
  end if;
  if v_regime='Simples Nacional' and (new.simples_annex is null or new.annex_iv_activity is null) then
    raise exception 'No Simples Nacional, informe o anexo e a classificação de atividade desta lotação.';
  end if;
  if v_regime='Simples Nacional' and (new.simples_annex='mixed' or new.annex_iv_activity is distinct from (new.simples_annex='IV')) then
    raise exception 'A lotação deve representar um único anexo e ter indicação coerente de atividade do Anexo IV.';
  end if;
  if v_regime<>'Simples Nacional' and (new.simples_annex is not null or new.annex_iv_activity is not null) then
    raise exception 'Anexo do Simples não se aplica a este regime tributário.';
  end if;
  if new.fap_year < extract(year from new.validity_from)::integer then raise exception 'O ano do FAP não pode ser anterior ao início da vigência.'; end if;
  if exists(select 1 from public.organization_payroll_tax_lotations l where l.organization_id=new.organization_id
    and l.lotation_code=new.lotation_code and l.id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid)
    and l.status='validated' and daterange(l.validity_from,coalesce(l.validity_to,'infinity'::date),'[]')
      && daterange(new.validity_from,coalesce(new.validity_to,'infinity'::date),'[]')) then
    raise exception 'Já existe lotação validada com o mesmo código e vigência sobreposta.';
  end if;
  new.validated_by:=coalesce(new.validated_by,(select auth.uid())); new.validated_at:=coalesce(new.validated_at,now());
 else new.validated_by:=null; new.validated_at:=null; end if;
 return new;
end $$;

create or replace function public.validate_payroll_employer_settings()
returns trigger language plpgsql set search_path='' as $$
declare v_regime text;
begin
 new.updated_at:=now();
 if new.status='validated' then
  select o.tax_regime into v_regime from public.organizations o where o.id=new.organization_id;
  if v_regime is null or new.tax_regime is distinct from v_regime then
    raise exception 'O regime tributário do enquadramento deve corresponder ao regime cadastrado na organização. Atualize o cadastro da empresa antes de validar.';
  end if;
  if nullif(trim(new.fpas_code),'') is null or nullif(trim(new.third_party_code),'') is null
    or nullif(trim(new.employer_inss_substitution),'') is null or nullif(trim(new.source_reference),'') is null then
    raise exception 'Informe FPAS, terceiros, tratamento patronal e fundamento documental.';
  end if;
  if new.tax_regime='Simples Nacional' and nullif(trim(coalesce(new.simples_annex,'')),'') is null then
    raise exception 'Informe o anexo do Simples Nacional.';
  end if;
  if new.tax_regime='Simples Nacional' and new.annex_iv_activity is null then
    raise exception 'Informe expressamente se há atividade enquadrada no Anexo IV.';
  end if;
  new.validated_by:=coalesce(new.validated_by,(select auth.uid())); new.validated_at:=coalesce(new.validated_at,now());
 else new.validated_by:=null; new.validated_at:=null; end if;
 return new;
end $$;

create or replace view public.payroll_lotation_assignment_audit
with(security_invoker=true) as
select r.organization_id,r.id payroll_run_id,r.reference_month competence,e.id payroll_entry_id,
 e.employee_id,e.employee_code,e.employee_name,count(a.id)::integer assignment_count,max(a.status) assignment_status,
 max(a.payroll_lotation_id::text)::uuid payroll_lotation_id,max(l.lotation_code) lotation_code,
 max(l.establishment_cnpj) establishment_cnpj,max(l.preponderant_cnae) preponderant_cnae,
 max(l.simples_annex) simples_annex,max(l.annex_iv_activity::integer)::boolean annex_iv_activity,
 max(l.fpas_code) fpas_code,max(l.third_party_code) third_party_code,max(l.third_party_rate) third_party_rate,
 max(l.rat_rate) rat_rate,max(l.fap_factor) fap_factor,max(l.fap_year) fap_year,max(l.employer_inss_rate) employer_inss_rate,
 case when count(a.id)=0 then 'missing_employee_lotation_assignment'
 when count(a.id)>1 then 'overlapping_employee_lotation_assignments'
 when max(a.status)<>'validated' then 'employee_lotation_assignment_pending'
 when bool_or(l.status<>'validated' or l.id is null) then 'lotation_not_validated'
 else 'validated_lotation_assignment' end audit_status
from public.payroll_runs r join public.payroll_entries e on e.payroll_run_id=r.id and e.organization_id=r.organization_id
left join public.employee_payroll_lotation_assignments a on a.organization_id=e.organization_id and a.employee_id=e.employee_id
 and a.status<>'inactive' and a.validity_from<=r.reference_month and(a.validity_to is null or a.validity_to>=r.reference_month)
left join public.organization_payroll_tax_lotations l on l.id=a.payroll_lotation_id and l.organization_id=a.organization_id
group by r.organization_id,r.id,r.reference_month,e.id,e.employee_id,e.employee_code,e.employee_name;
