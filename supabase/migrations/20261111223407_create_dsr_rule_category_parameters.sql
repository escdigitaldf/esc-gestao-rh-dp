create table public.organization_dsr_rule_category_parameters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  dsr_rule_id uuid not null references public.organization_dsr_rules(id) on delete restrict,
  category text not null check (category in ('overtime','commission','additional','bonus','other')),
  unit text not null check (unit in ('days','hours')),
  denominator numeric(14,4) not null check (denominator > 0),
  rest_units numeric(14,4) not null check (rest_units >= 0),
  effective_from date not null,
  effective_to date,
  status text not null default 'pending_validation'
    check (status in ('pending_validation','validated','rejected')),
  justification text not null check (length(btrim(justification)) between 10 and 4000),
  source_document_id uuid references public.organization_dsr_rule_documents(id) on delete restrict,
  source_reference text,
  version integer not null default 1 check (version > 0),
  supersedes_id uuid references public.organization_dsr_rule_category_parameters(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  validated_by uuid references auth.users(id) on delete restrict,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_dsr_rule_category_parameters_validity_check
    check (effective_to is null or effective_to >= effective_from),
  constraint organization_dsr_rule_category_parameters_audit_check
    check (status <> 'validated' or (validated_by is not null and validated_at is not null)),
  constraint organization_dsr_rule_category_parameters_rule_category_version_unique
    unique (dsr_rule_id, category, version)
);

create index organization_dsr_rule_category_parameters_lookup_idx
  on public.organization_dsr_rule_category_parameters
    (organization_id, dsr_rule_id, category, status, effective_from, effective_to);

alter table public.organization_dsr_rule_category_parameters enable row level security;

create policy organization_dsr_category_parameters_hr_select
  on public.organization_dsr_rule_category_parameters
  for select to authenticated
  using (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = organization_dsr_rule_category_parameters.organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and m.role in ('owner','admin','hr_manager','payroll')
    )
  );

create policy organization_dsr_category_parameters_hr_insert
  on public.organization_dsr_rule_category_parameters
  for insert to authenticated
  with check (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = organization_dsr_rule_category_parameters.organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and m.role in ('owner','admin','hr_manager','payroll')
    )
  );

create policy organization_dsr_category_parameters_hr_update
  on public.organization_dsr_rule_category_parameters
  for update to authenticated
  using (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = organization_dsr_rule_category_parameters.organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and m.role in ('owner','admin','hr_manager','payroll')
    )
  )
  with check (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = organization_dsr_rule_category_parameters.organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and m.role in ('owner','admin','hr_manager','payroll')
    )
  );

grant select, insert, update on public.organization_dsr_rule_category_parameters to authenticated;
revoke delete, truncate, references, trigger
  on public.organization_dsr_rule_category_parameters from anon, authenticated, public;

create or replace function public.guard_organization_dsr_rule_category_parameter()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_rule public.organization_dsr_rules%rowtype;
  v_doc public.organization_dsr_rule_documents%rowtype;
  v_user uuid := (select auth.uid());
  v_next_version integer;
begin
  if tg_op = 'DELETE' then
    raise exception 'Parâmetros de DSR não podem ser excluídos. Registre nova versão para preservar o histórico.';
  end if;

  if tg_op = 'INSERT' then
    if v_user is null or new.created_by is distinct from v_user then
      raise exception 'Responsável pelo cadastro inválido.';
    end if;
    if new.status <> 'pending_validation' then
      raise exception 'Novo parâmetro deve iniciar pendente de validação.';
    end if;
    if new.validated_by is not null or new.validated_at is not null then
      raise exception 'Novo parâmetro não pode iniciar com dados de validação.';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(new.dsr_rule_id::text || ':' || new.category, 0));

    select * into v_rule
    from public.organization_dsr_rules r
    where r.id = new.dsr_rule_id
      and r.organization_id = new.organization_id;

    if not found then
      raise exception 'A regra normativa não pertence à organização informada.';
    end if;

    if new.effective_from < coalesce(v_rule.validity_from, new.effective_from)
       or (v_rule.validity_to is not null and coalesce(new.effective_to, 'infinity'::date) > v_rule.validity_to) then
      raise exception 'A vigência do parâmetro deve estar dentro da vigência da regra normativa.';
    end if;

    if new.source_document_id is not null then
      select * into v_doc
      from public.organization_dsr_rule_documents d
      where d.id = new.source_document_id
        and d.dsr_rule_id = new.dsr_rule_id
        and d.organization_id = new.organization_id;
      if not found then
        raise exception 'O documento-fonte deve pertencer à mesma regra e organização.';
      end if;
    end if;

    if new.supersedes_id is not null and not exists (
      select 1 from public.organization_dsr_rule_category_parameters p
      where p.id = new.supersedes_id
        and p.dsr_rule_id = new.dsr_rule_id
        and p.organization_id = new.organization_id
        and p.category = new.category
    ) then
      raise exception 'A versão anterior deve pertencer à mesma regra e categoria.';
    end if;

    select coalesce(max(p.version), 0) + 1 into v_next_version
    from public.organization_dsr_rule_category_parameters p
    where p.dsr_rule_id = new.dsr_rule_id and p.category = new.category;
    new.version := v_next_version;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if old.status <> 'pending_validation' then
    raise exception 'Parâmetros decididos são imutáveis. Registre uma nova versão.';
  end if;

  if new.id <> old.id
     or new.organization_id <> old.organization_id
     or new.dsr_rule_id <> old.dsr_rule_id
     or new.category <> old.category
     or new.version <> old.version
     or new.supersedes_id is distinct from old.supersedes_id
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'Identidade e histórico da versão não podem ser alterados.';
  end if;

  if new.status = 'validated' then
    if v_user is null
       or new.validated_by is distinct from v_user
       or new.validated_at is null then
      raise exception 'A validação exige identificação do responsável e data.';
    end if;

    select * into v_rule
    from public.organization_dsr_rules r
    where r.id = old.dsr_rule_id
      and r.organization_id = old.organization_id
      and r.status = 'validated';

    if not found then
      raise exception 'A regra normativa principal precisa estar validada antes dos parâmetros.';
    end if;

    if new.effective_from < coalesce(v_rule.validity_from, new.effective_from)
       or (v_rule.validity_to is not null and coalesce(new.effective_to, 'infinity'::date) > v_rule.validity_to) then
      raise exception 'A vigência do parâmetro deve estar dentro da vigência da regra normativa.';
    end if;

    if new.source_document_id is not null then
      select * into v_doc
      from public.organization_dsr_rule_documents d
      where d.id = new.source_document_id
        and d.dsr_rule_id = old.dsr_rule_id
        and d.organization_id = old.organization_id;
      if not found then
        raise exception 'O documento-fonte deve pertencer à mesma regra e organização.';
      end if;
    elsif v_rule.source_type in ('cct','act') then
      raise exception 'Parâmetros baseados em CCT/ACT exigem vínculo ao PDF do instrumento coletivo.';
    elsif coalesce(nullif(btrim(new.source_reference),''),'') = '' then
      raise exception 'Informe a referência documental específica que fundamenta os parâmetros.';
    end if;

    if exists (
      select 1
      from public.organization_dsr_rule_category_parameters p
      where p.dsr_rule_id = old.dsr_rule_id
        and p.category = old.category
        and p.status = 'validated'
        and p.id <> old.id
        and daterange(p.effective_from, coalesce(p.effective_to + 1, 'infinity'::date), '[)')
            && daterange(new.effective_from, coalesce(new.effective_to + 1, 'infinity'::date), '[)')
    ) then
      raise exception 'Já existe parâmetro validado para esta categoria com vigência sobreposta.';
    end if;

    if not exists (
      select 1 from public.organization_memberships m
      where m.organization_id = old.organization_id
        and m.user_id = v_user
        and m.status = 'active'
        and m.role in ('owner','admin','hr_manager','payroll')
    ) then
      raise exception 'Usuário sem permissão para validar parâmetros de DSR.';
    end if;
  elsif new.status = 'rejected' then
    if v_user is null or new.validated_by is distinct from v_user or new.validated_at is null then
      raise exception 'A rejeição exige identificação do responsável e data.';
    end if;
  elsif new.status <> 'pending_validation' then
    raise exception 'Situação de parâmetro inválida.';
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

create trigger guard_organization_dsr_rule_category_parameter
  before insert or update or delete
  on public.organization_dsr_rule_category_parameters
  for each row execute function public.guard_organization_dsr_rule_category_parameter();
