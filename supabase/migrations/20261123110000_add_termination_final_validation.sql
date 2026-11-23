-- Etapa 11: revisão individual de itens e validação final transacional da rescisão.
-- A validação é bloqueada enquanto houver checklist incompleto, item pendente/bloqueado,
-- verba financeira sem fundamento ou fórmula ainda não concluída.

alter table public.payroll_termination_cases
  drop constraint if exists payroll_termination_cases_case_status_check;

alter table public.payroll_termination_cases
  add constraint payroll_termination_cases_case_status_check
  check (case_status in ('draft','in_review','ready_for_validation','validated','cancelled'));

create or replace function public.guard_payroll_termination_case_validation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.case_status = 'validated' or old.calculation_status = 'validated' then
      if current_setting('app.termination_final_validation', true) is distinct from 'on' then
        raise exception 'Processo rescisório validado: alterações posteriores estão bloqueadas.';
      end if;
    end if;

    if (
      new.case_status = 'validated' or new.calculation_status = 'validated'
    ) and (
      old.case_status is distinct from new.case_status
      or old.calculation_status is distinct from new.calculation_status
    ) and current_setting('app.termination_final_validation', true) is distinct from 'on' then
      raise exception 'A validação final só pode ocorrer pela operação transacional autorizada.';
    end if;
  elsif new.case_status = 'validated' or new.calculation_status = 'validated' then
    raise exception 'Um processo não pode ser criado diretamente como validado.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_payroll_termination_case_validation_trigger
  on public.payroll_termination_cases;
create trigger guard_payroll_termination_case_validation_trigger
before insert or update on public.payroll_termination_cases
for each row execute function public.guard_payroll_termination_case_validation();


create or replace function public.guard_payroll_termination_item_validation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case_status text;
  v_calculation_status text;
begin
  select c.case_status, c.calculation_status
    into v_case_status, v_calculation_status
  from public.payroll_termination_cases c
  where c.id = new.termination_case_id
    and c.organization_id = new.organization_id
  for key share;

  if not found then
    raise exception 'Processo rescisório não encontrado para o item.';
  end if;

  if v_case_status = 'validated' or v_calculation_status = 'validated' then
    raise exception 'Não é permitido incluir ou alterar itens após a validação final.';
  end if;

  if tg_op = 'UPDATE'
    and old.calculation_status is distinct from 'reviewed'
    and new.calculation_status = 'reviewed'
    and new.item_type <> 'information'
    and current_setting('app.termination_item_review', true) is distinct from 'on' then
    raise exception 'A revisão de verbas financeiras deve ocorrer pela operação de revisão autorizada.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_payroll_termination_item_validation_trigger
  on public.payroll_termination_calculation_items;
create trigger guard_payroll_termination_item_validation_trigger
before insert or update on public.payroll_termination_calculation_items
for each row execute function public.guard_payroll_termination_item_validation();


create or replace function public.review_payroll_termination_calculation_item(
  p_organization_id uuid,
  p_termination_case_id uuid,
  p_item_id uuid,
  p_review_notes text,
  p_confirmed boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.payroll_termination_calculation_items%rowtype;
begin
  if auth.uid() is null or p_confirmed is distinct from true then
    raise exception 'Autenticação e confirmação expressa do revisor são obrigatórias.';
  end if;

  if coalesce(trim(p_review_notes),'') = '' then
    raise exception 'Registre a evidência ou observação da conferência antes de revisar o item.';
  end if;

  if not exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any(array['owner','admin','hr_manager','payroll'])
  ) then
    raise exception 'Usuário sem autorização para revisar itens rescisórios.';
  end if;

  select i.* into v_item
  from public.payroll_termination_calculation_items i
  join public.payroll_termination_cases c
    on c.id = i.termination_case_id
   and c.organization_id = i.organization_id
  where i.id = p_item_id
    and i.organization_id = p_organization_id
    and i.termination_case_id = p_termination_case_id
    and c.case_status in ('draft','in_review','ready_for_validation')
    and c.calculation_status <> 'validated'
  for update of i;

  if not found then
    raise exception 'Item/processo não encontrado ou indisponível para revisão.';
  end if;

  if v_item.calculation_status not in ('draft','pending_review') then
    raise exception 'Somente itens em rascunho ou pendentes podem ser revisados.';
  end if;

  if v_item.item_type in ('earning','deduction','employer_charge') then
    if v_item.calculation_method = 'formula_pending' then
      raise exception 'A fórmula deste item ainda está pendente; conclua o cálculo antes da revisão.';
    end if;
    if coalesce(trim(v_item.legal_basis),'') = '' then
      raise exception 'Informe o fundamento legal ou coletivo da verba antes da revisão.';
    end if;
  end if;

  perform set_config('app.termination_item_review','on',true);

  update public.payroll_termination_calculation_items
  set calculation_status = 'reviewed',
      review_notes = trim(p_review_notes),
      updated_by = auth.uid()
  where id = p_item_id;
end;
$$;


create or replace function public.validate_payroll_termination_case(
  p_organization_id uuid,
  p_termination_case_id uuid,
  p_justification text,
  p_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.payroll_termination_cases%rowtype;
  v_item_count integer;
  v_unreviewed_count integer;
  v_incomplete_checklist_count integer;
  v_snapshot jsonb;
  v_now timestamptz := now();
begin
  if auth.uid() is null or p_confirmed is distinct from true then
    raise exception 'Autenticação e confirmação expressa da validação são obrigatórias.';
  end if;

  if coalesce(trim(p_justification),'') = '' then
    raise exception 'A justificativa da validação final é obrigatória.';
  end if;

  if not exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any(array['owner','admin','hr_manager','payroll'])
  ) then
    raise exception 'Usuário sem autorização para validar este processo rescisório.';
  end if;

  select * into v_case
  from public.payroll_termination_cases c
  where c.id = p_termination_case_id
    and c.organization_id = p_organization_id
  for update;

  if not found or v_case.case_status not in ('in_review','ready_for_validation') then
    raise exception 'O processo precisa estar em conferência ou aguardando validação final.';
  end if;

  if v_case.calculation_status = 'blocked_missing_data' then
    raise exception 'Processo bloqueado por ausência de dados. Resolva as pendências antes da validação.';
  end if;

  select count(*) into v_incomplete_checklist_count
  from jsonb_array_elements(v_case.checklist) as checklist_item(value)
  where coalesce((checklist_item.value->>'done')::boolean,false) is not true;

  if jsonb_array_length(v_case.checklist) = 0 or v_incomplete_checklist_count > 0 then
    raise exception 'Checklist documental incompleto: conclua todos os itens antes da validação.';
  end if;

  select count(*) into v_item_count
  from public.payroll_termination_calculation_items i
  where i.organization_id = p_organization_id
    and i.termination_case_id = p_termination_case_id;

  if v_item_count = 0 then
    raise exception 'A memória de cálculo está vazia; inclua e revise as verbas aplicáveis antes da validação.';
  end if;

  select count(*) into v_unreviewed_count
  from public.payroll_termination_calculation_items i
  where i.organization_id = p_organization_id
    and i.termination_case_id = p_termination_case_id
    and (
      i.calculation_status <> 'reviewed'
      or (
        i.item_type in ('earning','deduction','employer_charge')
        and (
          i.calculation_method = 'formula_pending'
          or coalesce(trim(i.legal_basis),'') = ''
        )
      )
    );

  if v_unreviewed_count > 0 then
    raise exception 'Existem itens pendentes, bloqueados, sem fundamento ou com fórmula não concluída.';
  end if;

  select jsonb_build_object(
    'version',1,
    'validated_at',v_now,
    'validated_by',auth.uid(),
    'justification',trim(p_justification),
    'checklist',v_case.checklist,
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'id',i.id,
      'item_code',i.item_code,
      'item_type',i.item_type,
      'amount',i.amount,
      'calculation_method',i.calculation_method,
      'calculation_status',i.calculation_status,
      'legal_basis',i.legal_basis
    ) order by i.sort_order,i.created_at),'[]'::jsonb)
  ) into v_snapshot
  from public.payroll_termination_calculation_items i
  where i.organization_id = p_organization_id
    and i.termination_case_id = p_termination_case_id;

  perform set_config('app.termination_final_validation','on',true);

  update public.payroll_termination_cases
  set case_status = 'validated',
      calculation_status = 'validated',
      calculation_snapshot = coalesce(calculation_snapshot,'{}'::jsonb) ||
        jsonb_build_object('final_validation',v_snapshot),
      updated_by = auth.uid()
  where id = p_termination_case_id
    and organization_id = p_organization_id;

  return jsonb_build_object(
    'status','validated',
    'validated_at',v_now,
    'validated_by',auth.uid(),
    'items_reviewed',v_item_count
  );
end;
$$;

revoke all on function public.review_payroll_termination_calculation_item(uuid,uuid,uuid,text,boolean) from public, anon;
grant execute on function public.review_payroll_termination_calculation_item(uuid,uuid,uuid,text,boolean) to authenticated;

revoke all on function public.validate_payroll_termination_case(uuid,uuid,text,boolean) from public, anon;
grant execute on function public.validate_payroll_termination_case(uuid,uuid,text,boolean) to authenticated;

comment on function public.review_payroll_termination_calculation_item(uuid,uuid,uuid,text,boolean) is
'Revisa individualmente item rescisório, exigindo autorização, confirmação, observação e fundamento para verbas financeiras.';

comment on function public.validate_payroll_termination_case(uuid,uuid,text,boolean) is
'Valida processo rescisório atomicamente somente com checklist completo e todos os itens revisados, sem fórmulas financeiras pendentes; congela processo e itens.';
