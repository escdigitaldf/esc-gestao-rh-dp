-- Complete the first-stage separation of employee identity data.
-- Backfill only missing protected rows; never overwrite data already maintained in protected tables.
alter table public.employee_personal_data
  add column if not exists social_name text;

alter table public.employees
  alter column cpf drop not null;

insert into public.employee_personal_data (
  organization_id, employee_id, social_name, cpf, birth_date, gender, marital_status,
  nationality, naturality_city, naturality_state, mother_name, father_name,
  rg_number, rg_issuer, rg_state, rg_issue_date, pis_pasep, ctps_number,
  ctps_series, ctps_state, voter_registration, voter_zone, voter_section,
  military_certificate, education_level, personal_email, phone, mobile_phone,
  zip_code, address_street, address_number, address_complement, neighborhood,
  city, state, emergency_contact_name, emergency_contact_phone, created_by, updated_by
)
select
  e.organization_id, e.id, e.social_name, e.cpf, e.birth_date, e.gender, e.marital_status,
  e.nationality, e.naturality_city, e.naturality_state, e.mother_name, e.father_name,
  e.rg_number, e.rg_issuer, e.rg_state, e.rg_issue_date, e.pis_pasep, e.ctps_number,
  e.ctps_series, e.ctps_state, e.voter_registration, e.voter_zone, e.voter_section,
  e.military_certificate, e.education_level, e.personal_email, e.phone, e.mobile_phone,
  e.zip_code, e.address_street, e.address_number, e.address_complement, e.neighborhood,
  e.city, e.state, e.emergency_contact_name, e.emergency_contact_phone, e.created_by, e.created_by
from public.employees e
on conflict (organization_id, employee_id) do nothing;

insert into public.employee_payment_data (
  organization_id, employee_id, salary_amount, salary_type, payment_method,
  bank_name, bank_branch, bank_account, bank_account_type, created_by, updated_by
)
select
  e.organization_id, e.id, e.salary_amount, e.salary_type, e.payment_method,
  e.bank_name, e.bank_branch, e.bank_account, e.bank_account_type, e.created_by, e.created_by
from public.employees e
on conflict (organization_id, employee_id) do nothing;

create or replace function public.upsert_employee_sensitive_data(
  p_organization_id uuid,
  p_employee_id uuid,
  p_personal_data jsonb,
  p_payment_data jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_role text;
begin
  if v_actor is null then
    raise exception 'Autenticação obrigatória.' using errcode = '42501';
  end if;

  select m.role into v_role
  from public.organization_memberships m
  where m.organization_id = p_organization_id
    and m.user_id = v_actor
    and m.status = 'active'
    and m.role in ('owner','admin','hr_manager')
  limit 1;

  if v_role is null then
    raise exception 'Sem permissão para atualizar dados pessoais e financeiros deste colaborador.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.organization_id = p_organization_id
  ) then
    raise exception 'Colaborador não encontrado na organização ativa.'
      using errcode = '23503';
  end if;

  insert into public.employee_personal_data (
    organization_id, employee_id, social_name, cpf, birth_date, gender, marital_status,
    nationality, naturality_city, naturality_state, mother_name, father_name,
    rg_number, rg_issuer, rg_state, rg_issue_date, pis_pasep, ctps_number,
    ctps_series, ctps_state, voter_registration, voter_zone, voter_section,
    military_certificate, education_level, personal_email, phone, mobile_phone,
    zip_code, address_street, address_number, address_complement, neighborhood,
    city, state, emergency_contact_name, emergency_contact_phone, created_by, updated_by
  )
  select
    p_organization_id, p_employee_id, x.social_name, x.cpf, x.birth_date, x.gender, x.marital_status,
    x.nationality, x.naturality_city, x.naturality_state, x.mother_name, x.father_name,
    x.rg_number, x.rg_issuer, x.rg_state, x.rg_issue_date, x.pis_pasep, x.ctps_number,
    x.ctps_series, x.ctps_state, x.voter_registration, x.voter_zone, x.voter_section,
    x.military_certificate, x.education_level, x.personal_email, x.phone, x.mobile_phone,
    x.zip_code, x.address_street, x.address_number, x.address_complement, x.neighborhood,
    x.city, x.state, x.emergency_contact_name, x.emergency_contact_phone, v_actor, v_actor
  from jsonb_populate_record(null::public.employee_personal_data, coalesce(p_personal_data, '{}'::jsonb)) as x
  on conflict (organization_id, employee_id) do update set
    social_name = excluded.social_name,
    cpf = excluded.cpf,
    birth_date = excluded.birth_date,
    gender = excluded.gender,
    marital_status = excluded.marital_status,
    nationality = excluded.nationality,
    naturality_city = excluded.naturality_city,
    naturality_state = excluded.naturality_state,
    mother_name = excluded.mother_name,
    father_name = excluded.father_name,
    rg_number = excluded.rg_number,
    rg_issuer = excluded.rg_issuer,
    rg_state = excluded.rg_state,
    rg_issue_date = excluded.rg_issue_date,
    pis_pasep = excluded.pis_pasep,
    ctps_number = excluded.ctps_number,
    ctps_series = excluded.ctps_series,
    ctps_state = excluded.ctps_state,
    voter_registration = excluded.voter_registration,
    voter_zone = excluded.voter_zone,
    voter_section = excluded.voter_section,
    military_certificate = excluded.military_certificate,
    education_level = excluded.education_level,
    personal_email = excluded.personal_email,
    phone = excluded.phone,
    mobile_phone = excluded.mobile_phone,
    zip_code = excluded.zip_code,
    address_street = excluded.address_street,
    address_number = excluded.address_number,
    address_complement = excluded.address_complement,
    neighborhood = excluded.neighborhood,
    city = excluded.city,
    state = excluded.state,
    emergency_contact_name = excluded.emergency_contact_name,
    emergency_contact_phone = excluded.emergency_contact_phone,
    updated_by = v_actor,
    updated_at = now();

  insert into public.employee_payment_data (
    organization_id, employee_id, salary_amount, salary_type, payment_method,
    bank_name, bank_branch, bank_account, bank_account_type, created_by, updated_by
  )
  select
    p_organization_id, p_employee_id, x.salary_amount, x.salary_type, x.payment_method,
    x.bank_name, x.bank_branch, x.bank_account, x.bank_account_type, v_actor, v_actor
  from jsonb_populate_record(null::public.employee_payment_data, coalesce(p_payment_data, '{}'::jsonb)) as x
  on conflict (organization_id, employee_id) do update set
    salary_amount = excluded.salary_amount,
    salary_type = excluded.salary_type,
    payment_method = excluded.payment_method,
    bank_name = excluded.bank_name,
    bank_branch = excluded.bank_branch,
    bank_account = excluded.bank_account,
    bank_account_type = excluded.bank_account_type,
    updated_by = v_actor,
    updated_at = now();
end;
$function$;

revoke all on function public.upsert_employee_sensitive_data(uuid, uuid, jsonb, jsonb) from public;
grant execute on function public.upsert_employee_sensitive_data(uuid, uuid, jsonb, jsonb) to authenticated;

comment on column public.employee_personal_data.social_name is
  'Nome social do colaborador; mantido na tabela pessoal protegida por RLS.';
comment on column public.employees.cpf is
  'Coluna legada, nullable durante a transição; novos cadastros gravam CPF em employee_personal_data.';
