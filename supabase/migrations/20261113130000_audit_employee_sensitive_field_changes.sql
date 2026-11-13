create or replace function public.audit_employee_sensitive_field_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_sensitive_fields constant text[] := array[
    'cpf',
    'birth_date',
    'personal_email',
    'phone',
    'mobile_phone',
    'mother_name',
    'father_name',
    'rg_number',
    'rg_issuer',
    'rg_state',
    'rg_issue_date',
    'pis_pasep',
    'ctps_number',
    'ctps_series',
    'ctps_state',
    'voter_registration',
    'voter_zone',
    'voter_section',
    'military_certificate',
    'zip_code',
    'address_street',
    'address_number',
    'address_complement',
    'neighborhood',
    'city',
    'state',
    'emergency_contact_name',
    'emergency_contact_phone',
    'salary_amount',
    'salary_type',
    'payment_method',
    'bank_name',
    'bank_branch',
    'bank_account',
    'bank_account_type'
  ];
  v_field text;
  v_changed_fields text[] := array[]::text[];
  v_actor uuid;
begin
  v_actor := (select auth.uid());

  if v_actor is null then
    raise exception 'A alteração de dados pessoais ou financeiros exige usuário autenticado.'
      using errcode = '42501';
  end if;

  foreach v_field in array v_sensitive_fields loop
    if (to_jsonb(old) -> v_field) is distinct from (to_jsonb(new) -> v_field) then
      v_changed_fields := array_append(v_changed_fields, v_field);
    end if;
  end loop;

  if cardinality(v_changed_fields) > 0 then
    insert into public.audit_logs (
      organization_id,
      actor_user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) values (
      new.organization_id,
      v_actor,
      'UPDATE_SENSITIVE_EMPLOYEE_DATA',
      'employees',
      new.id::text,
      jsonb_build_object(
        'changed_fields', to_jsonb(v_changed_fields),
        'audit_scope', 'sensitive_employee_fields'
      )
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists employees_audit_sensitive_field_changes on public.employees;

create trigger employees_audit_sensitive_field_changes
after update on public.employees
for each row
execute function public.audit_employee_sensitive_field_changes();

comment on function public.audit_employee_sensitive_field_changes() is
  'Registra somente os nomes dos campos pessoais/financeiros alterados, sem copiar valores sensíveis para o log.';
