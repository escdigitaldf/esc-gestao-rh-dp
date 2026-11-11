create or replace function public.guard_organization_dsr_rule_document()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rule_org uuid;
  v_expected_prefix text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Documentos normativos são imutáveis. Inclua uma nova versão.';
  end if;

  select r.organization_id into v_rule_org
  from public.organization_dsr_rules r
  where r.id = new.dsr_rule_id;

  if v_rule_org is null or v_rule_org <> new.organization_id then
    raise exception 'A regra documental deve pertencer à mesma organização.';
  end if;

  if new.uploaded_by is distinct from (select auth.uid()) then
    raise exception 'Responsável pelo envio inválido.';
  end if;

  v_expected_prefix := new.organization_id::text || '/' || new.dsr_rule_id::text || '/';
  if left(new.storage_path, length(v_expected_prefix)) <> v_expected_prefix
     or right(lower(new.storage_path), 4) <> '.pdf'
     or new.storage_path !~* ('^' || new.organization_id::text || '/' || new.dsr_rule_id::text || '/[0-9a-f-]{36}[.]pdf$') then
    raise exception 'Caminho do arquivo inválido.';
  end if;

  if new.mime_type <> 'application/pdf' or new.file_size < 1 or new.file_size > 15728640 then
    raise exception 'Arquivo fora dos limites permitidos.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.dsr_rule_id::text, 0));
  select coalesce(max(d.document_version), 0) + 1
    into new.document_version
  from public.organization_dsr_rule_documents d
  where d.dsr_rule_id = new.dsr_rule_id;

  new.uploaded_at := now();
  return new;
end;
$$;

revoke all on function public.guard_organization_dsr_rule_document() from public, anon;