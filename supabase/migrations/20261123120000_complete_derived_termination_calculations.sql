-- Etapa 17: concluir o recálculo de verbas derivadas de médias sem alterar a origem.
-- O item derivado continua pendente de revisão até a RPC de revisão individual.

create or replace function public.validate_payroll_termination_item_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.payroll_termination_calculation_items%rowtype;
  v_review jsonb;
  v_destination_calculation jsonb;
  v_completed boolean := false;
begin
  if new.source_calculation_item_id is null then
    return new;
  end if;

  if new.id = new.source_calculation_item_id then
    raise exception 'Um item não pode ser sua própria origem.';
  end if;

  select * into v_source
  from public.payroll_termination_calculation_items
  where id = new.source_calculation_item_id
  for key share;

  v_review := coalesce(v_source.calculation_snapshot -> 'review','{}'::jsonb);
  v_destination_calculation := coalesce(new.calculation_snapshot -> 'destination_calculation','{}'::jsonb);

  if not found
    or v_source.organization_id is distinct from new.organization_id
    or v_source.termination_case_id is distinct from new.termination_case_id
    or v_source.item_type <> 'information'
    or v_source.calculation_status <> 'reviewed'
    or left(coalesce(v_source.item_code,''),6) <> 'MEDIA_'
    or coalesce(v_review ->> 'status','') <> 'reviewed_for_routing'
    or coalesce(v_review ->> 'destination','') = ''
    or coalesce(v_review ->> 'legal_basis','') = ''
    or coalesce(new.calculation_snapshot -> 'destination' ->> 'kind','') <> coalesce(v_review ->> 'destination','')
    or coalesce(new.calculation_snapshot -> 'destination' ->> 'label','') <> coalesce(v_review ->> 'destination_label','')
    or coalesce(trim(new.legal_basis),'') = '' then
    raise exception 'A origem deve ser uma média informativa revisada e encaminhada no mesmo processo e organização.';
  end if;

  if new.item_type <> 'earning' then
    raise exception 'O item derivado de média deve manter natureza de provento.';
  end if;

  if new.calculation_status = 'pending_review'
    and new.calculation_method = 'formula_pending'
    and new.amount = v_source.amount
    and coalesce(trim(new.legal_basis),'') = coalesce(v_review ->> 'legal_basis','')
    and coalesce(v_destination_calculation,'{}'::jsonb) = '{}'::jsonb then
    v_completed := false;
  elsif new.calculation_status = 'pending_review'
    and new.calculation_method in ('manual','parameter_table')
    and current_setting('app.termination_derived_calculation',true) = 'on'
    and coalesce(v_destination_calculation ->> 'status','') = 'completed'
    and coalesce(v_destination_calculation ->> 'source_item_id','') = v_source.id::text
    and coalesce(v_destination_calculation ->> 'source_amount','')::numeric = v_source.amount
    and coalesce(v_destination_calculation ->> 'final_amount','')::numeric = new.amount
    and coalesce(v_destination_calculation ->> 'method','') = new.calculation_method
    and coalesce(trim(v_destination_calculation ->> 'evidence'),'') <> ''
    and coalesce(trim(v_destination_calculation ->> 'legal_basis'),'') = coalesce(trim(new.legal_basis),'')
    and (
      (new.calculation_method = 'manual' and new.source_parameter_table_id is null)
      or
      (new.calculation_method = 'parameter_table'
        and new.source_parameter_table_id is not null
        and exists (
          select 1 from public.payroll_parameter_tables pt
          where pt.id = new.source_parameter_table_id
            and pt.organization_id = new.organization_id
        ))
    ) then
    v_completed := true;
  else
    raise exception 'O item derivado deve permanecer pendente no estado inicial ou ser concluído pela operação autorizada de recálculo.';
  end if;

  if tg_op = 'UPDATE' and old.source_calculation_item_id is distinct from new.source_calculation_item_id then
    raise exception 'A origem de um item derivado é imutável.';
  end if;

  return new;
end;
$$;

create or replace function public.complete_payroll_termination_derived_calculation(
  p_organization_id uuid,
  p_termination_case_id uuid,
  p_item_id uuid,
  p_final_amount numeric,
  p_calculation_method text,
  p_calculation_base numeric,
  p_rate numeric,
  p_reference_period text,
  p_reference_quantity numeric,
  p_reference_unit text,
  p_source_parameter_table_id uuid,
  p_evidence text,
  p_legal_basis text,
  p_confirmed boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_case public.payroll_termination_cases%rowtype;
  v_item public.payroll_termination_calculation_items%rowtype;
  v_now timestamptz := now();
  v_snapshot jsonb;
begin
  if auth.uid() is null or p_confirmed is distinct from true then
    raise exception 'Autenticação e confirmação expressa do DP são obrigatórias.';
  end if;

  if p_final_amount is null or p_final_amount < 0
    or p_calculation_method is null
    or p_calculation_method not in ('manual','parameter_table')
    or coalesce(trim(p_evidence),'') = ''
    or coalesce(trim(p_legal_basis),'') = '' then
    raise exception 'Informe valor final não negativo, método concluído, evidência e fundamento legal/coletivo.';
  end if;

  if p_calculation_method = 'parameter_table' and p_source_parameter_table_id is null then
    raise exception 'A conclusão por tabela exige a identificação da tabela de parâmetros utilizada.';
  end if;

  if p_calculation_method = 'manual' and p_source_parameter_table_id is not null then
    raise exception 'Não informe tabela de parâmetros quando o método concluído for manual.';
  end if;

  if p_calculation_method = 'parameter_table' and not exists (
    select 1 from public.payroll_parameter_tables pt
    where pt.id = p_source_parameter_table_id
      and pt.organization_id = p_organization_id
  ) then
    raise exception 'A tabela de parâmetros deve existir e pertencer à mesma organização do processo.';
  end if;

  if not exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any(array['owner','admin','hr_manager','payroll'])
  ) then
    raise exception 'Usuário sem autorização para concluir o recálculo rescisório.';
  end if;

  -- Serializa com a validação final, que também bloqueia a linha do processo.
  select * into v_case
  from public.payroll_termination_cases c
  where c.id = p_termination_case_id
    and c.organization_id = p_organization_id
  for update;

  if not found
    or v_case.case_status not in ('draft','in_review','ready_for_validation')
    or v_case.calculation_status = 'validated' then
    raise exception 'Processo inexistente, cancelado ou já validado.';
  end if;

  select * into v_item
  from public.payroll_termination_calculation_items i
  where i.id = p_item_id
    and i.organization_id = p_organization_id
    and i.termination_case_id = p_termination_case_id
  for update;

  if not found
    or v_item.source_calculation_item_id is null
    or v_item.item_type <> 'earning'
    or v_item.calculation_status <> 'pending_review'
    or v_item.calculation_method <> 'formula_pending' then
    raise exception 'Somente uma verba derivada de média, ainda pendente de recálculo, pode ser concluída por esta operação.';
  end if;

  v_snapshot := coalesce(v_item.calculation_snapshot,'{}'::jsonb) ||
    jsonb_build_object('destination_calculation',jsonb_build_object(
      'status','completed',
      'source_item_id',v_item.source_calculation_item_id,
      'source_amount',v_item.amount,
      'final_amount',p_final_amount,
      'method',p_calculation_method,
      'calculation_base',p_calculation_base,
      'rate',p_rate,
      'reference_period',nullif(trim(coalesce(p_reference_period,'')),''),
      'reference_quantity',p_reference_quantity,
      'reference_unit',nullif(trim(coalesce(p_reference_unit,'')),''),
      'source_parameter_table_id',p_source_parameter_table_id,
      'evidence',trim(p_evidence),
      'legal_basis',trim(p_legal_basis),
      'completed_by',auth.uid(),
      'completed_at',v_now,
      'confirmation',true
    ));

  perform set_config('app.termination_derived_calculation','on',true);

  update public.payroll_termination_calculation_items
  set amount = p_final_amount,
      calculation_method = p_calculation_method,
      calculation_status = 'pending_review',
      calculation_base = p_calculation_base,
      rate = p_rate,
      reference_period = nullif(trim(coalesce(p_reference_period,'')),''),
      reference_quantity = p_reference_quantity,
      reference_unit = nullif(trim(coalesce(p_reference_unit,'')),''),
      source_parameter_table_id = p_source_parameter_table_id,
      calculation_snapshot = v_snapshot,
      legal_basis = trim(p_legal_basis),
      review_notes = trim(p_evidence),
      updated_by = auth.uid()
  where id = p_item_id
    and organization_id = p_organization_id
    and termination_case_id = p_termination_case_id;

  return jsonb_build_object(
    'status','calculation_completed_pending_review',
    'item_id',p_item_id,
    'source_item_id',v_item.source_calculation_item_id,
    'source_amount',v_item.amount,
    'final_amount',p_final_amount,
    'method',p_calculation_method,
    'completed_at',v_now,
    'completed_by',auth.uid()
  );
end;
$$;

revoke all on function public.complete_payroll_termination_derived_calculation(
  uuid,uuid,uuid,numeric,text,numeric,numeric,text,numeric,text,uuid,text,text,boolean
) from public, anon;
grant execute on function public.complete_payroll_termination_derived_calculation(
  uuid,uuid,uuid,numeric,text,numeric,numeric,text,numeric,text,uuid,text,text,boolean
) to authenticated;

comment on function public.complete_payroll_termination_derived_calculation(
  uuid,uuid,uuid,numeric,text,numeric,numeric,text,numeric,text,uuid,text,text,boolean
) is
'Conclui o recálculo de uma verba derivada de média, preserva a evidência da origem e mantém o item pendente de revisão individual.';
