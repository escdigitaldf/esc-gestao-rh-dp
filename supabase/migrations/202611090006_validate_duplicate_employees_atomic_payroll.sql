-- Reforça validação para impedir colaborador duplicado no payload da geração atômica.
create or replace function public.create_payroll_run_atomic(
  p_organization_id uuid,
  p_run_payload jsonb,
  p_entries jsonb,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_run_id uuid;
  v_entry jsonb;
  v_item jsonb;
  v_entry_id uuid;
  v_employee_id uuid;
  v_entry_map jsonb := '{}'::jsonb;
begin
  if v_user_id is null then raise exception 'Sessão não autenticada.'; end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.organization_id=p_organization_id and m.user_id=v_user_id
      and m.status='active' and m.role in ('owner','admin','hr_manager','payroll')
  ) then raise exception 'Usuário sem permissão para gerar folha nesta organização.'; end if;
  if jsonb_typeof(p_run_payload)<>'object' or jsonb_typeof(p_entries)<>'array'
     or jsonb_array_length(p_entries)=0 or jsonb_typeof(p_items)<>'array' then
    raise exception 'Dados da folha inválidos ou incompletos.';
  end if;
  if (select count(distinct value->>'employee_id') from jsonb_array_elements(p_entries)) <> jsonb_array_length(p_entries) then
    raise exception 'A lista contém colaboradores duplicados.';
  end if;
  insert into public.payroll_runs (
    organization_id,reference_month,payment_date,status,created_by,tax_year,
    tax_parameters_snapshot,calculation_notes,notes
  ) values (
    p_organization_id,(p_run_payload->>'reference_month')::date,
    nullif(p_run_payload->>'payment_date','')::date,'processing',v_user_id,
    nullif(p_run_payload->>'tax_year','')::integer,
    coalesce(p_run_payload->'tax_parameters_snapshot','{}'::jsonb),
    p_run_payload->>'calculation_notes',p_run_payload->>'notes'
  ) returning id into v_run_id;
  for v_entry in select value from jsonb_array_elements(p_entries) loop
    v_employee_id := (v_entry->>'employee_id')::uuid;
    if not exists(select 1 from public.employees e where e.id=v_employee_id and e.organization_id=p_organization_id) then
      raise exception 'Colaborador inválido para esta organização.';
    end if;
    insert into public.payroll_entries(
      organization_id,payroll_run_id,employee_id,employee_code,employee_name,salary_base,status
    ) values (
      p_organization_id,v_run_id,v_employee_id,v_entry->>'employee_code',
      v_entry->>'employee_name',(v_entry->>'salary_base')::numeric,'pending'
    ) returning id into v_entry_id;
    v_entry_map := v_entry_map || jsonb_build_object(v_employee_id::text,v_entry_id::text);
  end loop;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_employee_id := (v_item->>'employee_id')::uuid;
    v_entry_id := nullif(v_entry_map->>v_employee_id::text,'')::uuid;
    if v_entry_id is null then raise exception 'Rubrica sem lançamento individual correspondente.'; end if;
    insert into public.payroll_entry_items(
      organization_id,payroll_entry_id,item_type,code,description,reference_value,amount,
      affects_inss,affects_irrf,affects_fgts
    ) values (
      p_organization_id,v_entry_id,v_item->>'item_type',v_item->>'code',v_item->>'description',
      nullif(v_item->>'reference_value','')::numeric,(v_item->>'amount')::numeric,
      coalesce((v_item->>'affects_inss')::boolean,false),
      coalesce((v_item->>'affects_irrf')::boolean,false),
      coalesce((v_item->>'affects_fgts')::boolean,false)
    );
  end loop;
  return v_run_id;
end;
$$;
