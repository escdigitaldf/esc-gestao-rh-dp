-- Reproduces the DSR rule-document storage and metadata objects already applied
-- to the production Supabase project (migration version 20261111013915).
-- This file is committed for repository/migration-history consistency; do not
-- re-apply it to the production database under a different migration version.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organization-dsr-documents',
  'organization-dsr-documents',
  false,
  15728640,
  array['application/pdf']::text[]
)
on conflict (id) do nothing;

create table if not exists public.organization_dsr_rule_documents (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  dsr_rule_id uuid not null references public.organization_dsr_rules(id) on delete restrict,
  file_name text not null check (length(btrim(file_name)) between 1 and 240),
  storage_path text not null unique,
  mime_type text not null check (mime_type = 'application/pdf'),
  file_size bigint not null check (file_size between 1 and 15728640),
  document_version integer not null check (document_version > 0),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  notes text,
  constraint organization_dsr_rule_documents_version_unique unique (dsr_rule_id, document_version)
);

create index if not exists organization_dsr_rule_documents_org_rule_version_idx
  on public.organization_dsr_rule_documents (organization_id, dsr_rule_id, document_version desc);

alter table public.organization_dsr_rule_documents enable row level security;

drop policy if exists organization_dsr_rule_documents_hr_select
  on public.organization_dsr_rule_documents;
create policy organization_dsr_rule_documents_hr_select
  on public.organization_dsr_rule_documents
  for select to authenticated
  using (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = organization_dsr_rule_documents.organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and m.role in ('owner', 'admin', 'hr_manager', 'payroll')
    )
  );

drop policy if exists organization_dsr_rule_documents_hr_insert
  on public.organization_dsr_rule_documents;
create policy organization_dsr_rule_documents_hr_insert
  on public.organization_dsr_rule_documents
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = organization_dsr_rule_documents.organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and m.role in ('owner', 'admin', 'hr_manager', 'payroll')
    )
  );

grant select, insert on public.organization_dsr_rule_documents to authenticated;
revoke update, delete, truncate, references, trigger
  on public.organization_dsr_rule_documents from anon, authenticated, public;

create or replace function public.guard_organization_dsr_rule_document()
returns trigger
language plpgsql
set search_path = ''
as $function$
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
$function$;

drop trigger if exists guard_organization_dsr_rule_document
  on public.organization_dsr_rule_documents;
create trigger guard_organization_dsr_rule_document
  before insert or update or delete on public.organization_dsr_rule_documents
  for each row execute function public.guard_organization_dsr_rule_document();

drop policy if exists organization_dsr_docs_storage_select on storage.objects;
create policy organization_dsr_docs_storage_select
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'organization-dsr-documents'
    and exists (
      select 1
      from public.organization_dsr_rules r
      join public.organization_memberships m on m.organization_id = r.organization_id
      where r.id::text = (storage.foldername(objects.name))[2]
        and r.organization_id::text = (storage.foldername(objects.name))[1]
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and m.role in ('owner', 'admin', 'hr_manager', 'payroll')
    )
  );

drop policy if exists organization_dsr_docs_storage_insert on storage.objects;
create policy organization_dsr_docs_storage_insert
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'organization-dsr-documents'
    and lower(storage.extension(name)) = 'pdf'
    and exists (
      select 1
      from public.organization_dsr_rules r
      join public.organization_memberships m on m.organization_id = r.organization_id
      where r.id::text = (storage.foldername(objects.name))[2]
        and r.organization_id::text = (storage.foldername(objects.name))[1]
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and m.role in ('owner', 'admin', 'hr_manager', 'payroll')
    )
  );
