-- Garante rastreabilidade da incidência patronal por rubrica e impede
-- alteração manual do snapshot depois da inclusão do item na folha.
create or replace function public.propagate_payroll_item_employer_incidence()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_event public.payroll_variable_events%rowtype;
  v_rubric public.payroll_rubrics%rowtype;
  v_employee_id uuid;
  v_matches integer;
begin
  if tg_op = 'UPDATE' then
    if new.rubric_id is distinct from old.rubric_id
      or new.affects_employer_inss is distinct from old.affects_employer_inss
      or new.affects_rat is distinct from old.affects_rat
      or new.affects_third_parties is distinct from old.affects_third_parties
      or new.affects_payroll_pis is distinct from old.affects_payroll_pis then
      raise exception 'A rubrica de origem e as incidências patronais do item da folha são snapshots imutáveis.';
    end if;
    return new;
  end if;

  if new.payroll_variable_event_id is not null then
    select * into v_event
    from public.payroll_variable_events e
    where e.id = new.payroll_variable_event_id
      and e.organization_id = new.organization_id
      and e.status = 'approved';

    if not found then
      raise exception 'Evento variável vinculado não está aprovado nesta organização.';
    end if;

    select e.employee_id into v_employee_id
    from public.payroll_entries e
    where e.id = new.payroll_entry_id
      and e.organization_id = new.organization_id;

    if not found or v_employee_id is distinct from v_event.employee_id then
      raise exception 'O evento variável e o lançamento individual pertencem a colaboradores diferentes.';
    end if;

    if v_event.rubric_id is null
      or v_event.affects_employer_inss is null
      or v_event.affects_rat is null
      or v_event.affects_third_parties is null
      or v_event.affects_payroll_pis is null then
      raise exception 'Evento variável sem rubrica ou incidências patronais completas; regularize a origem antes de integrar à folha.';
    end if;

    new.rubric_id := v_event.rubric_id;
    new.affects_employer_inss := v_event.affects_employer_inss;
    new.affects_rat := v_event.affects_rat;
    new.affects_third_parties := v_event.affects_third_parties;
    new.affects_payroll_pis := v_event.affects_payroll_pis;
    return new;
  end if;

  if new.rubric_id is not null then
    select * into v_rubric
    from public.payroll_rubrics r
    where r.id = new.rubric_id
      and r.organization_id = new.organization_id
      and r.active;

    if not found then
      raise exception 'Rubrica vinculada ao item inexistente, inativa ou de outra organização.';
    end if;
  else
    select count(*)::integer into v_matches
    from public.payroll_rubrics r
    where r.organization_id = new.organization_id
      and r.code = new.code
      and r.item_type = new.item_type
      and r.active;

    if v_matches <> 1 then
      -- Sem rubrica única, o item será preservado, mas a prévia patronal o bloqueará.
      new.affects_employer_inss := null;
      new.affects_rat := null;
      new.affects_third_parties := null;
      new.affects_payroll_pis := null;
      return new;
    end if;

    select * into v_rubric
    from public.payroll_rubrics r
    where r.organization_id = new.organization_id
      and r.code = new.code
      and r.item_type = new.item_type
      and r.active
    limit 1;

    new.rubric_id := v_rubric.id;
  end if;

  new.affects_employer_inss := v_rubric.affects_employer_inss;
  new.affects_rat := v_rubric.affects_rat;
  new.affects_third_parties := v_rubric.affects_third_parties;
  new.affects_payroll_pis := v_rubric.affects_payroll_pis;
  return new;
end;
$function$;

drop trigger if exists propagate_payroll_item_employer_incidence_trigger
  on public.payroll_entry_items;

create trigger propagate_payroll_item_employer_incidence_trigger
before insert or update on public.payroll_entry_items
for each row
execute function public.propagate_payroll_item_employer_incidence();

-- A prévia exige uma rubrica de origem e as quatro incidências definidas
-- para cada rubrica remuneratória; não basta preencher flags manualmente.
do $patch$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  v_definition := pg_get_functiondef(
    'public.preview_payroll_employer_charges(uuid)'::regprocedure
  );

  v_old := '      and (i.affects_employer_inss is null or i.affects_rat is null'
        || E'\n' || '        or i.affects_third_parties is null or i.affects_payroll_pis is null);';

  v_new := '      and (i.rubric_id is null'
        || E'\n' || '        or i.affects_employer_inss is null or i.affects_rat is null'
        || E'\n' || '        or i.affects_third_parties is null or i.affects_payroll_pis is null);';

  if position(v_old in v_definition) = 0 then
    raise exception 'Não foi localizado o critério de classificação das rubricas na prévia patronal. Migração cancelada.';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end;
$patch$;

comment on function public.propagate_payroll_item_employer_incidence() is
  'Congela rubrica de origem e incidências patronais no item da folha; impede alteração direta do snapshot e exige rubrica rastreável.';
