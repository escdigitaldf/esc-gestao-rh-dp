-- Etapa 18: permitir a revisão individual de um recálculo derivado já concluído.
-- A conclusão do recálculo mantém pending_review; somente a RPC de revisão
-- pode promover o item para reviewed, preservando a evidência de cálculo.

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
  v_source_amount numeric;
  v_final_amount numeric;
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
    -- Estado inicial: valor copiado da média, ainda sem cálculo de destino.
    null;

  elsif new.calculation_status in ('pending_review','reviewed')
    and new.calculation_method in ('manual','parameter_table')
    and coalesce(v_destination_calculation ->> 'status','') = 'completed'
    and coalesce(v_destination_calculation ->> 'source_item_id','') = v_source.id::text
    and coalesce(v_destination_calculation ->> 'method','') = new.calculation_method
    and coalesce(trim(v_destination_calculation ->> 'evidence'),'') <> ''
    and coalesce(trim(v_destination_calculation ->> 'legal_basis'),'') = coalesce(trim(new.legal_basis),'')
    and coalesce(v_destination_calculation ->> 'confirmation','false') = 'true'
    and (
      (new.calculation_status = 'pending_review'
        and current_setting('app.termination_derived_calculation',true) = 'on')
      or
      (new.calculation_status = 'reviewed'
        and tg_op = 'UPDATE'
        and old.calculation_status = 'pending_review'
        and current_setting('app.termination_item_review',true) = 'on')
    )
    and (
      (new.calculation_method = 'manual'
        and new.source_parameter_table_id is null
        and coalesce(v_destination_calculation ->> 'source_parameter_table_id','') = '')
      or
      (new.calculation_method = 'parameter_table'
        and new.source_parameter_table_id is not null
        and coalesce(v_destination_calculation ->> 'source_parameter_table_id','') = new.source_parameter_table_id::text
        and exists (
          select 1 from public.payroll_parameter_tables pt
          where pt.id = new.source_parameter_table_id
            and pt.organization_id = new.organization_id
        ))
    ) then
    v_source_amount := nullif(v_destination_calculation ->> 'source_amount','')::numeric;
    v_final_amount := nullif(v_destination_calculation ->> 'final_amount','')::numeric;

    if v_source_amount is distinct from v_source.amount
      or v_final_amount is distinct from new.amount then
      raise exception 'O snapshot do recálculo não corresponde aos valores persistidos ou à média de origem.';
    end if;

    if new.calculation_status = 'reviewed'
      and (
        tg_op <> 'UPDATE'
        or old.calculation_status <> 'pending_review'
        or current_setting('app.termination_item_review',true) is distinct from 'on'
      ) then
      raise exception 'A promoção do item derivado para revisado exige a operação autorizada de revisão individual.';
    end if;

  else
    raise exception 'O item derivado deve permanecer pendente no estado inicial ou possuir recálculo concluído e evidenciado.';
  end if;

  if tg_op = 'UPDATE' and old.source_calculation_item_id is distinct from new.source_calculation_item_id then
    raise exception 'A origem de um item derivado é imutável.';
  end if;

  return new;
end;
$$;

comment on function public.validate_payroll_termination_item_source() is
'Valida vínculo e snapshot de verbas derivadas; aceita recálculo concluído pendente e sua revisão individual autorizada, sem permitir alteração da origem.';
