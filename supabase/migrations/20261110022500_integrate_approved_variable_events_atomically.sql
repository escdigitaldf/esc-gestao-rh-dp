-- Event-variable integration: preserve incidence and source-event identity,
-- then process all approved events atomically with the payroll run.
alter table public.payroll_entry_items
  add column if not exists affects_dsr boolean not null default false,
  add column if not exists payroll_variable_event_id uuid
    references public.payroll_variable_events(id) on delete restrict;

create unique index if not exists payroll_entry_items_variable_event_uidx
  on public.payroll_entry_items(payroll_variable_event_id)
  where payroll_variable_event_id is not null;

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
  v_event_count integer := 0;
  v_linked_event_count integer := 0;
  v_entry_map jsonb := '{}'::jsonb;
begin
  if v_user_id is null then raise exception 'Sessão não autenticada.'; end if;
  if not exists (select 1 from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=v_user_id and m.status='active' and m.role in ('owner','admin','hr_manager','payroll')) then
    raise exception 'Usuário sem permissão para gerar folha nesta organização.';
  end if;
  if jsonb_typeof(p_run_payload)<>'object' or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)=0 or jsonb_typeof(p_items)<>'array' then
    raise exception 'Dados da folha inválidos ou incompletos.';
  end if;
  if (select count(distinct value->>'employee_id') from jsonb_array_elements(p_entries))<>jsonb_array_length(p_entries) then
    raise exception 'A lista contém colaboradores duplicados.';
  end if;

  perform e.id from public.payroll_variable_events e
  where e.organization_id=p_organization_id and e.competence=(p_run_payload->>'reference_month')::date and e.status='approved'
  order by e.id for update;

  select count(*) into v_event_count from public.payroll_variable_events e
  where e.organization_id=p_organization_id and e.competence=(p_run_payload->>'reference_month')::date and e.status='approved';

  if exists(select 1 from public.payroll_variable_events e where e.organization_id=p_organization_id and e.competence=(p_run_payload->>'reference_month')::date and e.status='approved' and e.affects_dsr=true) then
    raise exception 'Há eventos aprovados com incidência de DSR. Configure e valide o cálculo de DSR antes de gerar esta folha.';
  end if;
  if exists(select 1 from public.payroll_variable_events e where e.organization_id=p_organization_id and e.competence=(p_run_payload->>'reference_month')::date and e.status='approved' and not exists(select 1 from jsonb_array_elements(p_entries) p where p->>'employee_id'=e.employee_id::text)) then
    raise exception 'Há eventos aprovados de colaboradores sem lançamento nesta folha. Regularize o vínculo e o histórico salarial antes de continuar.';
  end if;

  select count(*) into v_linked_event_count from jsonb_array_elements(p_items) i where nullif(i->>'payroll_variable_event_id','') is not null;
  if v_linked_event_count<>v_event_count then raise exception 'A relação de eventos aprovados mudou ou está incompleta. Atualize a folha e tente novamente.'; end if;
  if v_event_count>0 and (select count(distinct i->>'payroll_variable_event_id') from jsonb_array_elements(p_items) i where nullif(i->>'payroll_variable_event_id','') is not null)<>v_event_count then
    raise exception 'Há eventos variáveis duplicados no conjunto de rubricas.';
  end if;
  if exists(
    select 1 from public.payroll_variable_events e
    where e.organization_id=p_organization_id and e.competence=(p_run_payload->>'reference_month')::date and e.status='approved'
    and not exists(
      select 1 from jsonb_array_elements(p_items) i
      where i->>'payroll_variable_event_id'=e.id::text and i->>'employee_id'=e.employee_id::text
      and i->>'code'=e.code and i->>'description'=e.description and i->>'item_type'=e.item_type
      and (i->>'amount')::numeric=e.amount
      and coalesce((i->>'affects_inss')::boolean,false)=e.affects_inss
      and coalesce((i->>'affects_irrf')::boolean,false)=e.affects_irrf
      and coalesce((i->>'affects_fgts')::boolean,false)=e.affects_fgts
      and coalesce((i->>'affects_dsr')::boolean,false)=e.affects_dsr
    )
  ) then raise exception 'Os dados dos eventos aprovados não correspondem às rubricas enviadas para a folha.'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) i where nullif(i->>'payroll_variable_event_id','') is not null and not exists(select 1 from public.payroll_variable_events e where e.id::text=i->>'payroll_variable_event_id' and e.organization_id=p_organization_id and e.competence=(p_run_payload->>'reference_month')::date and e.status='approved')) then
    raise exception 'Foi enviado evento variável que não está aprovado para esta competência.';
  end if;

  insert into public.payroll_runs(organization_id,reference_month,payment_date,status,created_by,tax_year,tax_parameters_snapshot,calculation_notes,notes)
  values(p_organization_id,(p_run_payload->>'reference_month')::date,nullif(p_run_payload->>'payment_date','')::date,'processing',v_user_id,nullif(p_run_payload->>'tax_year','')::integer,coalesce(p_run_payload->'tax_parameters_snapshot','{}'::jsonb),p_run_payload->>'calculation_notes',p_run_payload->>'notes')
  returning id into v_run_id;

  for v_entry in select value from jsonb_array_elements(p_entries) loop
    v_employee_id:=(v_entry->>'employee_id')::uuid;
    if not exists(select 1 from public.employees e where e.id=v_employee_id and e.organization_id=p_organization_id) then raise exception 'Colaborador inválido para esta organização.'; end if;
    insert into public.payroll_entries(organization_id,payroll_run_id,employee_id,employee_code,employee_name,salary_base,status)
    values(p_organization_id,v_run_id,v_employee_id,v_entry->>'employee_code',v_entry->>'employee_name',(v_entry->>'salary_base')::numeric,'pending')
    returning id into v_entry_id;
    v_entry_map:=v_entry_map||jsonb_build_object(v_employee_id::text,v_entry_id::text);
  end loop;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_employee_id:=(v_item->>'employee_id')::uuid;
    v_entry_id:=nullif(v_entry_map->>v_employee_id::text,'')::uuid;
    if v_entry_id is null then raise exception 'Rubrica sem lançamento individual correspondente.'; end if;
    insert into public.payroll_entry_items(organization_id,payroll_entry_id,item_type,code,description,reference_value,amount,affects_inss,affects_irrf,affects_fgts,affects_dsr,payroll_variable_event_id)
    values(p_organization_id,v_entry_id,v_item->>'item_type',v_item->>'code',v_item->>'description',nullif(v_item->>'reference_value','')::numeric,(v_item->>'amount')::numeric,coalesce((v_item->>'affects_inss')::boolean,false),coalesce((v_item->>'affects_irrf')::boolean,false),coalesce((v_item->>'affects_fgts')::boolean,false),coalesce((v_item->>'affects_dsr')::boolean,false),nullif(v_item->>'payroll_variable_event_id','')::uuid);
  end loop;

  perform set_config('app.payroll_event_processing','on',true);
  update public.payroll_variable_events e set status='processed',processed_entry_id=(v_entry_map->>e.employee_id::text)::uuid,updated_at=now()
  where e.organization_id=p_organization_id and e.competence=(p_run_payload->>'reference_month')::date and e.status='approved';

  return v_run_id;
end;
$$;
revoke all on function public.create_payroll_run_atomic(uuid,jsonb,jsonb,jsonb) from public;
revoke all on function public.create_payroll_run_atomic(uuid,jsonb,jsonb,jsonb) from anon;
grant execute on function public.create_payroll_run_atomic(uuid,jsonb,jsonb,jsonb) to authenticated;
