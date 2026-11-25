create table if not exists public.payroll_employer_charge_previews (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 payroll_run_id uuid not null, competence date not null,
 status text not null check(status in ('preview','blocked')),
 calculation_version text not null default '2026.11.19.1',
 total_employer_inss numeric(14,2) not null default 0,
 total_rat numeric(14,2) not null default 0,
 total_third_parties numeric(14,2) not null default 0,
 total_payroll_pis numeric(14,2) not null default 0,
 total_charges numeric(14,2) not null default 0,
 blocked_count integer not null default 0,
 snapshot jsonb not null default '[]'::jsonb,
 created_by uuid, created_at timestamptz not null default now(),
 unique(id,organization_id),
 foreign key(payroll_run_id,organization_id) references public.payroll_runs(id,organization_id) on delete restrict
);
create index if not exists payroll_employer_charge_previews_org_run_idx
 on public.payroll_employer_charge_previews(organization_id,payroll_run_id,created_at desc);
alter table public.payroll_employer_charge_previews enable row level security;
drop policy if exists payroll_employer_charge_previews_select on public.payroll_employer_charge_previews;
create policy payroll_employer_charge_previews_select on public.payroll_employer_charge_previews
 for select to authenticated using(exists(select 1 from public.organization_memberships m
 where m.organization_id=payroll_employer_charge_previews.organization_id
 and m.user_id=(select auth.uid()) and m.status='active'));
grant select on public.payroll_employer_charge_previews to authenticated;
revoke insert,update,delete on public.payroll_employer_charge_previews from anon,authenticated;

CREATE OR REPLACE FUNCTION public.preview_payroll_employer_charges(p_payroll_run_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_competence date;
  v_month_end date;
  v_entry record;
  v_assignment_count integer;
  v_lotation public.organization_payroll_tax_lotations%rowtype;
  v_unclassified integer;
  v_base_inss numeric(14,2);
  v_base_rat numeric(14,2);
  v_base_third numeric(14,2);
  v_base_pis numeric(14,2);
  v_cpp_rate numeric(9,5);
  v_rat_rate numeric(9,5);
  v_third_rate numeric(9,5);
  v_pis_rate numeric(9,5);
  v_cpp numeric(14,2);
  v_rat numeric(14,2);
  v_third numeric(14,2);
  v_pis numeric(14,2);
  v_issue text;
  v_status text;
  v_snapshot jsonb := '[]'::jsonb;
  v_total_cpp numeric(14,2) := 0;
  v_total_rat numeric(14,2) := 0;
  v_total_third numeric(14,2) := 0;
  v_total_pis numeric(14,2) := 0;
  v_blocked integer := 0;
  v_preview_id uuid;
  v_role text;
begin
  if v_user is null then raise exception 'Autenticação necessária.'; end if;

  select r.organization_id, date_trunc('month', r.reference_month)::date
    into v_org, v_competence
  from public.payroll_runs r where r.id = p_payroll_run_id;

  if v_org is null then raise exception 'Folha não encontrada.'; end if;

  select m.role into v_role
  from public.organization_memberships m
  where m.organization_id = v_org and m.user_id = v_user and m.status = 'active'
  limit 1;

  if v_role is null or v_role not in ('owner','admin','hr_manager','payroll') then
    raise exception 'Perfil sem permissão para prévia de encargos patronais.';
  end if;

  v_month_end := (v_competence + interval '1 month - 1 day')::date;

  if not exists (select 1 from public.payroll_entries e where e.payroll_run_id=p_payroll_run_id and e.organization_id=v_org) then
    raise exception 'A folha não possui lançamentos de colaboradores para calcular.';
  end if;

  for v_entry in
    select e.id, e.employee_id, e.employee_code, e.employee_name
    from public.payroll_entries e
    where e.payroll_run_id=p_payroll_run_id and e.organization_id=v_org
    order by e.employee_code
  loop
    v_issue := null;
    v_lotation := null;

    select count(*)::integer into v_assignment_count
    from public.employee_payroll_lotation_assignments a
    join public.organization_payroll_tax_lotations l
      on l.id=a.payroll_lotation_id and l.organization_id=a.organization_id
    where a.organization_id=v_org and a.employee_id=v_entry.employee_id
      and a.status='validated' and l.status='validated'
      and a.validity_from <= v_competence and coalesce(a.validity_to,'infinity'::date) >= v_month_end
      and l.validity_from <= v_competence and coalesce(l.validity_to,'infinity'::date) >= v_month_end;

    if v_assignment_count <> 1 then
      v_issue := case when v_assignment_count=0 then 'Atribuição/lotação tributária validada não cobre toda a competência.'
                      else 'Mais de uma atribuição tributária válida cobre a competência.' end;
    else
      select l.* into v_lotation
      from public.employee_payroll_lotation_assignments a
      join public.organization_payroll_tax_lotations l
        on l.id=a.payroll_lotation_id and l.organization_id=a.organization_id
      where a.organization_id=v_org and a.employee_id=v_entry.employee_id
        and a.status='validated' and l.status='validated'
        and a.validity_from <= v_competence and coalesce(a.validity_to,'infinity'::date) >= v_month_end
        and l.validity_from <= v_competence and coalesce(l.validity_to,'infinity'::date) >= v_month_end
      limit 1;
    end if;

    select count(*)::integer into v_unclassified
    from public.payroll_entry_items i
    where i.organization_id=v_org and i.payroll_entry_id=v_entry.id
      and lower(i.item_type)='earning'
      and (i.affects_employer_inss is null or i.affects_rat is null
        or i.affects_third_parties is null or i.affects_payroll_pis is null);

    select
      coalesce(sum(i.amount) filter (where lower(i.item_type)='earning' and i.affects_employer_inss is true),0),
      coalesce(sum(i.amount) filter (where lower(i.item_type)='earning' and i.affects_rat is true),0),
      coalesce(sum(i.amount) filter (where lower(i.item_type)='earning' and i.affects_third_parties is true),0),
      coalesce(sum(i.amount) filter (where lower(i.item_type)='earning' and i.affects_payroll_pis is true),0)
    into v_base_inss, v_base_rat, v_base_third, v_base_pis
    from public.payroll_entry_items i
    where i.organization_id=v_org and i.payroll_entry_id=v_entry.id;

    if v_issue is null and v_unclassified > 0 then
      v_issue := 'Existem rubricas remuneratórias sem classificação completa das incidências patronais.';
    end if;

    if v_issue is null and v_base_pis > 0 then
      v_issue := 'PIS sobre folha ainda não possui regra de cálculo habilitada nesta prévia; valide a incidência e o enquadramento específico antes de calcular.';
    end if;

    if v_issue is null and extract(year from v_competence)::integer <> v_lotation.fap_year then
      v_issue := 'O ano de vigência do FAP não corresponde à competência.';
    end if;

    if v_issue is null and v_lotation.tax_regime='Simples Nacional'
       and (v_lotation.simples_annex is null or v_lotation.annex_iv_activity is null) then
      v_issue := 'Anexo/atividade do Simples não foi validado para a lotação.';
    end if;

    if v_issue is null and v_lotation.employer_inss_substitution in ('partial','full','review_required') then
      v_issue := 'Substituição previdenciária parcial/integral ou situação especial exige regra específica; cálculo bloqueado.';
    end if;

    if v_issue is null and v_lotation.employer_inss_substitution='not_applicable'
       and not (v_lotation.tax_regime='Simples Nacional' and v_lotation.simples_annex <> 'IV') then
      v_issue := 'Contribuição patronal marcada como não aplicável fora da hipótese de CPP incluída no Simples; revisão necessária.';
    end if;

    v_cpp_rate := 0; v_rat_rate := 0; v_third_rate := 0; v_pis_rate := 0;
    v_cpp := 0; v_rat := 0; v_third := 0; v_pis := 0;

    if v_issue is null then
      if v_lotation.tax_regime='Simples Nacional' and v_lotation.simples_annex <> 'IV' then
        -- CPP/GILRAT/terceiros incluídos ou dispensados no DAS para anexos distintos do IV.
        v_cpp_rate := 0; v_rat_rate := 0; v_third_rate := 0;
      elsif v_lotation.tax_regime='Simples Nacional' and v_lotation.simples_annex='IV' then
        v_cpp_rate := v_lotation.employer_inss_rate;
        v_rat_rate := v_lotation.rat_rate * v_lotation.fap_factor;
        v_third_rate := 0;
      else
        v_cpp_rate := v_lotation.employer_inss_rate;
        v_rat_rate := v_lotation.rat_rate * v_lotation.fap_factor;
        v_third_rate := v_lotation.third_party_rate;
      end if;

      v_cpp := round(v_base_inss * v_cpp_rate / 100,2);
      v_rat := round(v_base_rat * v_rat_rate / 100,2);
      v_third := round(v_base_third * v_third_rate / 100,2);
    end if;

    if v_issue is not null then
      v_blocked := v_blocked + 1;
      v_status := 'blocked';
      v_cpp := 0; v_rat := 0; v_third := 0; v_pis := 0;
    else
      v_status := 'calculated';
      v_total_cpp := v_total_cpp + v_cpp;
      v_total_rat := v_total_rat + v_rat;
      v_total_third := v_total_third + v_third;
      v_total_pis := v_total_pis + v_pis;
    end if;

    v_snapshot := v_snapshot || jsonb_build_array(jsonb_build_object(
      'payroll_entry_id',v_entry.id,'employee_id',v_entry.employee_id,
      'employee_code',v_entry.employee_code,'employee_name',v_entry.employee_name,
      'lotation_id',v_lotation.id,'lotation_code',v_lotation.lotation_code,
      'tax_regime',v_lotation.tax_regime,'simples_annex',v_lotation.simples_annex,
      'fpas_code',v_lotation.fpas_code,'third_party_code',v_lotation.third_party_code,
      'fap_year',v_lotation.fap_year,'fap_factor',v_lotation.fap_factor,
      'bases',jsonb_build_object('employer_inss',v_base_inss,'rat',v_base_rat,'third_parties',v_base_third,'payroll_pis',v_base_pis),
      'rates',jsonb_build_object('employer_inss',v_cpp_rate,'rat_adjusted',v_rat_rate,'third_parties',v_third_rate,'payroll_pis',v_pis_rate),
      'amounts',jsonb_build_object('employer_inss',v_cpp,'rat',v_rat,'third_parties',v_third,'payroll_pis',v_pis),
      'status',v_status,'issue',v_issue
    ));
  end loop;

  insert into public.payroll_employer_charge_previews(
    organization_id,payroll_run_id,competence,status,total_employer_inss,total_rat,
    total_third_parties,total_payroll_pis,total_charges,blocked_count,snapshot,created_by
  ) values (
    v_org,p_payroll_run_id,v_competence,
    case when v_blocked>0 then 'blocked' else 'preview' end,
    case when v_blocked>0 then 0 else v_total_cpp end,
    case when v_blocked>0 then 0 else v_total_rat end,
    case when v_blocked>0 then 0 else v_total_third end,
    case when v_blocked>0 then 0 else v_total_pis end,
    case when v_blocked>0 then 0 else v_total_cpp+v_total_rat+v_total_third+v_total_pis end,
    v_blocked,v_snapshot,v_user
  ) returning id into v_preview_id;

  return v_preview_id;
end;
$function$;

grant select on public.payroll_employer_charge_previews to authenticated;
revoke insert,update,delete on public.payroll_employer_charge_previews from anon,authenticated;
revoke execute on function public.preview_payroll_employer_charges(uuid) from public,anon;
grant execute on function public.preview_payroll_employer_charges(uuid) to authenticated;
