create or replace function public.audit_employee_sensitive_table_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_org uuid;
  v_employee uuid;
  v_actor uuid := (select auth.uid());
  v_fields text[] := array[]::text[];
  v_key text;
  v_old jsonb;
  v_new jsonb;
  v_action text;
begin
  if v_actor is null then
    raise exception 'A alteração de dados sensíveis exige usuário autenticado.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_org := new.organization_id;
    v_employee := new.employee_id;
    v_action := 'INSERT_SENSITIVE_EMPLOYEE_DATA';
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key not in ('id','organization_id','employee_id','created_at','updated_at','created_by','updated_by') then
        v_fields := array_append(v_fields, v_key);
      end if;
    end loop;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_org := new.organization_id;
    v_employee := new.employee_id;
    v_action := 'UPDATE_SENSITIVE_EMPLOYEE_DATA';
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key not in ('id','organization_id','employee_id','created_at','updated_at','created_by','updated_by')
         and (v_old -> v_key) is distinct from (v_new -> v_key) then
        v_fields := array_append(v_fields, v_key);
      end if;
    end loop;
    if cardinality(v_fields) = 0 then return new; end if;
  else
    v_old := to_jsonb(old);
    v_org := old.organization_id;
    v_employee := old.employee_id;
    v_action := 'DELETE_SENSITIVE_EMPLOYEE_DATA';
    for v_key in select jsonb_object_keys(v_old) loop
      if v_key not in ('id','organization_id','employee_id','created_at','updated_at','created_by','updated_by') then
        v_fields := array_append(v_fields, v_key);
      end if;
    end loop;
  end if;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, resource_type, resource_id, metadata
  ) values (
    v_org, v_actor, v_action, tg_table_name, v_employee::text,
    jsonb_build_object('changed_fields', to_jsonb(v_fields), 'audit_scope', 'sensitive_employee_data')
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists employee_personal_data_audit_changes on public.employee_personal_data;
create trigger employee_personal_data_audit_changes
after insert or update or delete on public.employee_personal_data
for each row execute function public.audit_employee_sensitive_table_changes();

drop trigger if exists employee_payment_data_audit_changes on public.employee_payment_data;
create trigger employee_payment_data_audit_changes
after insert or update or delete on public.employee_payment_data
for each row execute function public.audit_employee_sensitive_table_changes();

comment on function public.audit_employee_sensitive_table_changes() is
  'Audita inserções, alterações e exclusões nas tabelas sensíveis sem gravar valores pessoais, bancários ou salariais.';
