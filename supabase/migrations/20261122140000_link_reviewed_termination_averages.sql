-- Vínculo auditável entre uma média informativa revisada e a verba preliminar dela derivada.
-- O vínculo não valida a verba de destino nem executa cálculo legal.

alter table public.payroll_termination_calculation_items
  add column if not exists source_calculation_item_id uuid
  references public.payroll_termination_calculation_items(id) on delete restrict;

create unique index if not exists payroll_termination_items_source_once_idx
  on public.payroll_termination_calculation_items(source_calculation_item_id)
  where source_calculation_item_id is not null;

alter table public.payroll_termination_calculation_items
  drop constraint if exists payroll_termination_item_source_type_chk;
alter table public.payroll_termination_calculation_items
  add constraint payroll_termination_item_source_type_chk
  check (source_calculation_item_id is null or item_type = 'earning');

create or replace function public.validate_payroll_termination_item_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.payroll_termination_calculation_items%rowtype;
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

  if not found
    or v_source.organization_id <> new.organization_id
    or v_source.termination_case_id <> new.termination_case_id
    or v_source.item_type <> 'information'
    or v_source.calculation_status <> 'reviewed'
    or v_source.item_code not like 'MEDIA_%'
    or coalesce(v_source.calculation_snapshot -> 'review' ->> 'status', '') <> 'reviewed_for_routing'
    or coalesce(v_source.calculation_snapshot -> 'review' ->> 'destination', '') = ''
    or coalesce(v_source.calculation_snapshot -> 'review' ->> 'legal_basis', '') = ''
    or coalesce(new.calculation_snapshot -> 'destination' ->> 'kind', '') <> coalesce(v_source.calculation_snapshot -> 'review' ->> 'destination', '')
    or coalesce(new.calculation_snapshot -> 'destination' ->> 'label', '') <> coalesce(v_source.calculation_snapshot -> 'review' ->> 'destination_label', '')
    or coalesce(trim(new.legal_basis), '') <> coalesce(v_source.calculation_snapshot -> 'review' ->> 'legal_basis', '') then
    raise exception 'A origem deve ser uma média informativa revisada e conferida para encaminhamento no mesmo processo e organização.';
  end if;

  if new.item_type <> 'earning'
    or new.calculation_status <> 'pending_review'
    or new.calculation_method <> 'formula_pending'
    or new.amount <> v_source.amount
    or coalesce(trim(new.legal_basis), '') = '' then
    raise exception 'A verba derivada deve preservar o valor da média e permanecer como provento pendente de revisão, com fundamento informado.';
  end if;

  if tg_op = 'UPDATE' and old.source_calculation_item_id is distinct from new.source_calculation_item_id then
    raise exception 'A origem de um item derivado é imutável.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_payroll_termination_item_source_trigger
  on public.payroll_termination_calculation_items;
create trigger validate_payroll_termination_item_source_trigger
before insert or update of source_calculation_item_id, item_type, organization_id, termination_case_id
on public.payroll_termination_calculation_items
for each row execute function public.validate_payroll_termination_item_source();

comment on column public.payroll_termination_calculation_items.source_calculation_item_id is
'Origem informativa revisada de uma verba preliminar derivada. Relação única, imutável e restrita ao mesmo processo e organização.';

-- Revisores autorizados da organização podem revisar itens criados por outro operador.
-- A autoria original continua imutável pelo trigger de auditoria já existente.
drop policy if exists payroll_termination_items_update on public.payroll_termination_calculation_items;
create policy payroll_termination_items_update
on public.payroll_termination_calculation_items for update to authenticated
using (exists (
  select 1
  from public.organization_memberships m
  join public.payroll_termination_cases c
    on c.organization_id = m.organization_id
   and c.id = payroll_termination_calculation_items.termination_case_id
  where m.organization_id = payroll_termination_calculation_items.organization_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role = any(array['owner','admin','hr_manager','payroll'])
    and c.case_status <> 'cancelled'
))
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1
    from public.organization_memberships m
    join public.payroll_termination_cases c
      on c.organization_id = m.organization_id
     and c.id = payroll_termination_calculation_items.termination_case_id
    where m.organization_id = payroll_termination_calculation_items.organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any(array['owner','admin','hr_manager','payroll'])
      and c.case_status <> 'cancelled'
  )
);

-- Operação transacional: revisa a média de origem e cria seu item derivado em uma única transação.
create or replace function public.route_payroll_termination_average(
  p_organization_id uuid,
  p_termination_case_id uuid,
  p_source_item_id uuid,
  p_destination text,
  p_destination_label text,
  p_legal_basis text,
  p_confirmed boolean
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.payroll_termination_calculation_items%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_label text;
  v_code text;
  v_now timestamptz := now();
begin
  if auth.uid() is null or p_confirmed is distinct from true then
    raise exception 'Autenticação e confirmação expressa do DP são obrigatórias.';
  end if;

  if p_destination is null or p_destination not in ('thirteenth','vacation','notice','other')
    or coalesce(trim(p_legal_basis),'') = ''
    or (p_destination = 'other' and coalesce(trim(p_destination_label),'') = '') then
    raise exception 'Destino e fundamento legal/coletivo são obrigatórios.';
  end if;

  if not exists (
    select 1
    from public.organization_memberships m
    join public.payroll_termination_cases c
      on c.organization_id = m.organization_id
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any(array['owner','admin','hr_manager','payroll'])
      and c.id = p_termination_case_id
      and c.case_status <> 'cancelled'
  ) then
    raise exception 'Usuário sem autorização para encaminhar médias neste processo.';
  end if;

  select * into v_source
  from public.payroll_termination_calculation_items
  where id = p_source_item_id
    and organization_id = p_organization_id
    and termination_case_id = p_termination_case_id
  for update;

  if not found
    or v_source.item_type <> 'information'
    or v_source.item_code not like 'MEDIA_%'
    or v_source.calculation_status not in ('pending_review','reviewed') then
    raise exception 'A origem deve ser uma média informativa elegível do mesmo processo.';
  end if;

  if exists (
    select 1 from public.payroll_termination_calculation_items
    where source_calculation_item_id = p_source_item_id
  ) then
    raise exception 'Esta média já foi encaminhada para uma verba de destino.';
  end if;

  v_label := case p_destination
    when 'thirteenth' then '13º salário'
    when 'vacation' then 'Férias'
    when 'notice' then 'Aviso-prévio'
    else trim(p_destination_label)
  end;
  v_code := 'MEDIA_INTEGRADA_' || upper(p_destination) || '_' || upper(left(replace(p_source_item_id::text,'-',''),12));

  update public.payroll_termination_calculation_items
  set calculation_status = 'reviewed',
      review_notes = 'Média conferida pelo DP para encaminhamento. A verba derivada permanece pendente de revisão.',
      calculation_snapshot = coalesce(v_source.calculation_snapshot,'{}'::jsonb) ||
        jsonb_build_object('review',jsonb_build_object(
          'status','reviewed_for_routing',
          'reviewed_by',auth.uid(),
          'reviewed_at',v_now,
          'destination',p_destination,
          'destination_label',v_label,
          'legal_basis',trim(p_legal_basis)
        )),
      updated_by = auth.uid()
  where id = p_source_item_id;

  insert into public.payroll_termination_calculation_items (
    id, organization_id, termination_case_id, source_calculation_item_id,
    item_code, description, item_type, reference_period, reference_quantity,
    reference_unit, calculation_base, rate, amount, calculation_method,
    calculation_status, source_parameter_snapshot, calculation_snapshot,
    legal_basis, review_notes, sort_order, created_by, updated_by
  ) values (
    v_new_id, p_organization_id, p_termination_case_id, p_source_item_id,
    v_code, 'Média encaminhada para ' || v_label || ' — ' || v_source.description,
    'earning', v_source.reference_period, v_source.reference_quantity,
    v_source.reference_unit, v_source.amount, null, v_source.amount,
    'formula_pending', 'pending_review',
    jsonb_build_object(
      'source_item_id',v_source.id,
      'source_item_code',v_source.item_code,
      'source_average_amount',v_source.amount,
      'destination',p_destination,
      'destination_label',v_label,
      'legal_basis',trim(p_legal_basis)
    ),
    jsonb_build_object(
      'integration_version',2,
      'source',jsonb_build_object(
        'item_id',v_source.id,
        'item_code',v_source.item_code,
        'description',v_source.description,
        'amount',v_source.amount,
        'calculation_status','reviewed'
      ),
      'destination',jsonb_build_object('kind',p_destination,'label',v_label),
      'operator',jsonb_build_object(
        'user_id',auth.uid(),
        'confirmed',true,
        'legal_basis',trim(p_legal_basis),
        'created_at',v_now
      ),
      'controls',jsonb_build_array(
        'A origem é uma média informativa revisada; não é uma verba definitiva.',
        'O valor foi copiado sem recalcular a verba de destino.',
        'O item derivado permanece pendente de revisão e não pode ser tratado como validado.',
        'A integração jurídica, o período, a base e o critério de cálculo da verba de destino exigem conferência específica.'
      )
    ),
    trim(p_legal_basis),
    'Valor encaminhado da média de origem, sem recálculo. Conferir elegibilidade, período, base, divisor e regra legal/coletiva da verba de destino.',
    80, auth.uid(), auth.uid()
  );

  return v_new_id;
end;
$$;

revoke all on function public.route_payroll_termination_average(uuid,uuid,uuid,text,text,text,boolean) from public, anon;
grant execute on function public.route_payroll_termination_average(uuid,uuid,uuid,text,text,text,boolean) to authenticated;

-- Depois de encaminhada, a evidência de origem fica imutável para impedir divergência do snapshot derivado.
create or replace function public.protect_linked_termination_average_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.payroll_termination_calculation_items child
    where child.source_calculation_item_id = old.id
  ) and (
    new.item_type is distinct from old.item_type
    or new.amount is distinct from old.amount
    or new.calculation_status is distinct from old.calculation_status
    or new.calculation_snapshot is distinct from old.calculation_snapshot
  ) then
    raise exception 'A média de origem não pode ser alterada após seu encaminhamento; registre uma retificação auditável.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_linked_termination_average_source_trigger
  on public.payroll_termination_calculation_items;
create trigger protect_linked_termination_average_source_trigger
before update on public.payroll_termination_calculation_items
for each row execute function public.protect_linked_termination_average_source();

