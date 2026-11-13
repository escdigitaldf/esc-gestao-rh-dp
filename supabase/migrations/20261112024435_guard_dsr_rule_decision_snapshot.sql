create or replace function public.guard_organization_dsr_rule()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_has_document boolean;
begin
  if tg_op = 'INSERT' then
    if v_user is null or new.created_by is distinct from v_user then
      raise exception 'Responsável pelo cadastro inválido.';
    end if;
    if new.status <> 'pending_validation' then
      raise exception 'Nova regra de DSR deve iniciar pendente de validação.';
    end if;
    if new.validated_by is not null or new.validated_at is not null then
      raise exception 'Nova regra não pode conter dados de validação prévios.';
    end if;
    if not exists (
      select 1 from public.organization_memberships m
      where m.organization_id = new.organization_id
        and m.user_id = v_user and m.status = 'active'
        and m.role in ('owner','admin','hr_manager','payroll')
    ) then
      raise exception 'Usuário sem permissão para cadastrar regra de DSR.';
    end if;
    new.created_at := statement_timestamp();
    new.updated_at := statement_timestamp();
    return new;
  end if;

  if tg_op <> 'UPDATE' then
    raise exception 'Operação não permitida para regras normativas de DSR.';
  end if;

  if old.status = 'validated' then
    raise exception 'Regra validada é imutável. Cadastre uma nova versão para preservar o histórico.';
  end if;

  if old.id is distinct from new.id
     or old.organization_id is distinct from new.organization_id
     or old.created_by is distinct from new.created_by
     or old.created_at is distinct from new.created_at then
    raise exception 'Identidade e histórico da regra não podem ser alterados.';
  end if;

  if new.status = 'pending_validation' then
    if new.validated_by is not null or new.validated_at is not null then
      raise exception 'Regra pendente não pode conter dados de validação.';
    end if;
    new.updated_at := statement_timestamp();
    return new;
  end if;

  if new.status <> 'validated' or old.status <> 'pending_validation' then
    raise exception 'Transição de situação inválida para regra normativa.';
  end if;

  if new.rule_name is distinct from old.rule_name
     or new.professional_category is distinct from old.professional_category
     or new.union_name is distinct from old.union_name
     or new.source_type is distinct from old.source_type
     or new.source_identifier is distinct from old.source_identifier
     or new.validity_from is distinct from old.validity_from
     or new.validity_to is distinct from old.validity_to
     or new.document_reference is distinct from old.document_reference
     or new.rule_summary is distinct from old.rule_summary
     or new.calculation_method is distinct from old.calculation_method
     or new.calculation_parameters is distinct from old.calculation_parameters
     or new.validation_notes is distinct from old.validation_notes then
    raise exception 'O conteúdo da regra não pode ser alterado durante a validação. Corrija-o enquanto pendente e solicite nova decisão.';
  end if;

  if v_user is null or new.validated_by is distinct from v_user then
    raise exception 'A validação exige o usuário autenticado como responsável.';
  end if;

  if not exists (
    select 1 from public.organization_memberships m
    where m.organization_id = old.organization_id
      and m.user_id = v_user and m.status = 'active'
      and m.role in ('owner','admin','hr_manager','payroll')
  ) then
    raise exception 'Usuário sem permissão para validar regra de DSR.';
  end if;

  select exists (
    select 1 from public.organization_dsr_rule_documents d
    where d.dsr_rule_id = old.id
      and d.organization_id = old.organization_id
  ) into v_has_document;

  if old.source_type in ('cct','act') and not v_has_document then
    raise exception 'CCT/ACT exige o instrumento coletivo em PDF antes da validação.';
  end if;

  if old.source_type in ('law','internal_policy')
     and not v_has_document
     and (
       coalesce(nullif(btrim(old.document_reference),''),'') = ''
       or coalesce(nullif(btrim(old.rule_summary),''),'') = ''
     ) then
    raise exception 'A regra exige documento anexado ou referência documental e resumo do fundamento.';
  end if;

  new.validated_at := statement_timestamp();
  new.updated_at := statement_timestamp();
  return new;
end;
$function$;
