-- Retificação histórica de ocorrências e escalas validadas sem sobrescrever o registro original.
create table public.dsr_historical_correction_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  target_type text not null check (target_type in ('occurrence','schedule')),
  target_id uuid not null,
  competence_month date not null check (extract(day from competence_month)=1),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default statement_timestamp(),
  reason text not null check (length(btrim(reason)) >= 20),
  original_snapshot jsonb not null,
  proposed_snapshot jsonb not null,
  status text not null default 'awaiting_first_approval'
    check (status in ('awaiting_first_approval','awaiting_second_approval','approved','rejected')),
  first_approved_by uuid references auth.users(id) on delete restrict,
  first_approved_at timestamptz,
  second_approved_by uuid references auth.users(id) on delete restrict,
  second_approved_at timestamptz,
  decided_at timestamptz,
  unique (id, organization_id)
);

create index dsr_historical_correction_target_idx
on public.dsr_historical_correction_requests(organization_id,target_type,target_id,requested_at desc);
create index dsr_historical_correction_competence_idx
on public.dsr_historical_correction_requests(organization_id,competence_month,status);

create table public.dsr_historical_correction_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  organization_id uuid not null,
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approve','reject')),
  note text not null check (length(btrim(note)) >= 20),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (request_id,organization_id)
    references public.dsr_historical_correction_requests(id,organization_id) on delete restrict,
  unique(request_id,reviewer_user_id)
);

alter table public.dsr_historical_correction_requests enable row level security;
alter table public.dsr_historical_correction_decisions enable row level security;
revoke all on public.dsr_historical_correction_requests,public.dsr_historical_correction_decisions from public,anon,authenticated;
grant select on public.dsr_historical_correction_requests,public.dsr_historical_correction_decisions to authenticated;

create policy dsr_historical_correction_requests_select_member
on public.dsr_historical_correction_requests for select to authenticated
using (exists(select 1 from public.organization_memberships m
  where m.organization_id=dsr_historical_correction_requests.organization_id
    and m.user_id=(select auth.uid()) and m.status='active'));
create policy dsr_historical_correction_decisions_select_member
on public.dsr_historical_correction_decisions for select to authenticated
using (exists(select 1 from public.organization_memberships m
  where m.organization_id=dsr_historical_correction_decisions.organization_id
    and m.user_id=(select auth.uid()) and m.status='active'));

create or replace function public.guard_dsr_historical_correction_audit()
returns trigger language plpgsql set search_path=''
as $function$
begin
  if tg_table_name='dsr_historical_correction_requests'
     and tg_op='UPDATE'
     and current_setting('app.dsr_correction_decision',true)=old.id::text
     and new.organization_id is not distinct from old.organization_id
     and new.target_type is not distinct from old.target_type
     and new.target_id is not distinct from old.target_id
     and new.competence_month is not distinct from old.competence_month
     and new.requested_by is not distinct from old.requested_by
     and new.requested_at is not distinct from old.requested_at
     and new.reason is not distinct from old.reason
     and new.original_snapshot is not distinct from old.original_snapshot
     and new.proposed_snapshot is not distinct from old.proposed_snapshot then
    return new;
  end if;
  raise exception 'O histórico de retificações e decisões é imutável.';
end;
$function$;

create trigger guard_dsr_historical_correction_request_history
before update or delete on public.dsr_historical_correction_requests
for each row execute function public.guard_dsr_historical_correction_audit();
create trigger guard_dsr_historical_correction_decision_history
before update or delete on public.dsr_historical_correction_decisions
for each row execute function public.guard_dsr_historical_correction_audit();

create or replace function public.request_dsr_historical_correction(
  p_target_type text,
  p_target_id uuid,
  p_changes jsonb,
  p_reason text
)
returns public.dsr_historical_correction_requests
language plpgsql security definer set search_path=''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_org uuid;
  v_competence date;
  v_original jsonb;
  v_proposed jsonb;
  v_request public.dsr_historical_correction_requests%rowtype;
  v_key text;
begin
  if v_user is null then raise exception 'Autenticação obrigatória.'; end if;
  if p_target_type not in ('occurrence','schedule') then raise exception 'Tipo de registro inválido.'; end if;
  if p_changes is null or jsonb_typeof(p_changes)<>'object' or p_changes='{}'::jsonb then
    raise exception 'Informe os campos que precisam ser corrigidos.';
  end if;
  if length(btrim(coalesce(p_reason,'')))<20 then raise exception 'A justificativa deve conter pelo menos 20 caracteres.'; end if;

  if not exists(select 1 from public.organization_memberships m
    where m.user_id=v_user and m.status='active'
      and m.role in ('owner','admin','hr_manager','payroll')
      and (p_target_type='occurrence' and exists(select 1 from public.employee_work_occurrences x where x.id=p_target_id and x.organization_id=m.organization_id)
        or p_target_type='schedule' and exists(select 1 from public.employee_work_schedules x where x.id=p_target_id and x.organization_id=m.organization_id))) then
    raise exception 'Registro não localizado na organização ou perfil sem permissão.';
  end if;

  select m.organization_id into v_org
  from public.organization_memberships m
  where m.user_id=v_user and m.status='active'
    and m.role in ('owner','admin','hr_manager','payroll')
    and ((p_target_type='occurrence' and exists(select 1 from public.employee_work_occurrences x where x.id=p_target_id and x.organization_id=m.organization_id))
      or (p_target_type='schedule' and exists(select 1 from public.employee_work_schedules x where x.id=p_target_id and x.organization_id=m.organization_id)))
  order by case m.role when 'owner' then 1 when 'admin' then 2 else 3 end limit 1;

  if p_target_type='occurrence' then
    select to_jsonb(x),date_trunc('month',x.occurrence_date)::date
      into v_original,v_competence
    from public.dsr_effective_employee_work_occurrences x
    where x.id=p_target_id and x.organization_id=v_org and x.record_status='validated';
    if v_original is null then raise exception 'Somente ocorrência validada pode ser retificada.'; end if;
    for v_key in select jsonb_object_keys(p_changes) loop
      if v_key not in ('occurrence_type','scheduled_hours','worked_hours','holiday_id','notes') then
        raise exception 'Campo não permitido para retificação de ocorrência: %',v_key;
      end if;
    end loop;
    if p_changes ? 'occurrence_type' and p_changes->>'occurrence_type' not in ('workday','weekly_rest','holiday','compensatory_rest','absence_justified','absence_unjustified','leave','vacation','other') then
      raise exception 'Tipo de ocorrência inválido.';
    end if;
    if (p_changes ? 'scheduled_hours' and (jsonb_typeof(p_changes->'scheduled_hours')<>'number' or (p_changes->>'scheduled_hours')::numeric<0))
      or (p_changes ? 'worked_hours' and (jsonb_typeof(p_changes->'worked_hours')<>'number' or (p_changes->>'worked_hours')::numeric<0)) then
      raise exception 'Horas devem ser valores numéricos não negativos.';
    end if;
    if p_changes ? 'holiday_id' and p_changes->'holiday_id'<>'null'::jsonb and not exists(
      select 1 from public.organization_holidays h
      where h.id=(p_changes->>'holiday_id')::uuid and h.organization_id=v_org
        and h.holiday_date=(v_original->>'occurrence_date')::date
    ) then raise exception 'O feriado informado não corresponde à data e organização.'; end if;
  else
    select to_jsonb(x),date_trunc('month',x.effective_from)::date
      into v_original,v_competence
    from public.dsr_effective_employee_work_schedules x
    where x.id=p_target_id and x.organization_id=v_org and x.dsr_rule_status='validated';
    if v_original is null then raise exception 'Somente escala validada pode ser retificada.'; end if;
    for v_key in select jsonb_object_keys(p_changes) loop
      if v_key not in ('schedule_name','schedule_type','effective_to','work_days','weekly_rest_days','weekly_hours','cycle_days','cycle_pattern','dsr_rule_id') then
        raise exception 'Campo não permitido para retificação de escala: %',v_key;
      end if;
    end loop;
    if p_changes ? 'schedule_name' and length(btrim(p_changes->>'schedule_name'))=0 then raise exception 'Nome da escala não pode ficar vazio.'; end if;
    if p_changes ? 'schedule_type' and p_changes->>'schedule_type' not in ('fixed_weekly','rotating','twelve_by_thirty_six','custom') then raise exception 'Tipo de escala inválido.'; end if;
    if p_changes ? 'effective_to' and p_changes->'effective_to'<>'null'::jsonb and (p_changes->>'effective_to')::date<(v_original->>'effective_from')::date then raise exception 'Fim da vigência anterior ao início.'; end if;
    if p_changes ? 'weekly_hours' and p_changes->'weekly_hours'<>'null'::jsonb and (jsonb_typeof(p_changes->'weekly_hours')<>'number' or (p_changes->>'weekly_hours')::numeric<=0) then raise exception 'Carga horária deve ser positiva.'; end if;
    if p_changes ? 'dsr_rule_id' and p_changes->'dsr_rule_id'<>'null'::jsonb and not exists(
      select 1 from public.organization_dsr_rules r where r.id=(p_changes->>'dsr_rule_id')::uuid
        and r.organization_id=v_org and r.status='validated'
        and r.validity_from<=(v_original->>'effective_from')::date
        and (r.validity_to is null or r.validity_to>=coalesce((v_original->>'effective_to')::date,(v_original->>'effective_from')::date))
    ) then raise exception 'A regra normativa deve estar validada e cobrir a vigência da escala.'; end if;
  end if;

  if exists(select 1 from public.dsr_historical_correction_requests r
    where r.organization_id=v_org and r.target_type=p_target_type and r.target_id=p_target_id
      and r.status in ('awaiting_first_approval','awaiting_second_approval')) then
    raise exception 'Já existe uma retificação aguardando aprovação para este registro.';
  end if;

  v_proposed:=v_original||p_changes;
  insert into public.dsr_historical_correction_requests(
    organization_id,target_type,target_id,competence_month,requested_by,reason,original_snapshot,proposed_snapshot
  ) values(v_org,p_target_type,p_target_id,v_competence,v_user,btrim(p_reason),v_original,v_proposed)
  returning * into v_request;

  insert into public.audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,metadata)
  values(v_org,v_user,'dsr_historical_correction_requested','dsr_historical_correction',v_request.id::text,
    jsonb_build_object('target_type',p_target_type,'target_id',p_target_id,'competence_month',v_competence,'reason',btrim(p_reason)));

  return v_request;
end;
$function$;

create or replace function public.decide_dsr_historical_correction(
  p_request_id uuid,
  p_decision text,
  p_note text
)
returns public.dsr_historical_correction_requests
language plpgsql security definer set search_path=''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_request public.dsr_historical_correction_requests%rowtype;
begin
  if v_user is null then raise exception 'Autenticação obrigatória.'; end if;
  if p_decision not in ('approve','reject') then raise exception 'Decisão inválida.'; end if;
  if length(btrim(coalesce(p_note,'')))<20 then raise exception 'A justificativa deve conter pelo menos 20 caracteres.'; end if;

  select * into v_request from public.dsr_historical_correction_requests
  where id=p_request_id for update;
  if not found then raise exception 'Solicitação de retificação não encontrada.'; end if;
  if not exists(select 1 from public.organization_memberships m
    where m.organization_id=v_request.organization_id and m.user_id=v_user
      and m.status='active' and m.role in ('owner','admin','hr_manager','payroll')) then
    raise exception 'Perfil sem permissão para decidir a retificação.';
  end if;
  if v_request.requested_by=v_user then raise exception 'O solicitante não pode aprovar a própria retificação.'; end if;

  perform set_config('app.dsr_correction_decision',v_request.id::text,true);

  if v_request.status='awaiting_first_approval' then
    if p_decision='reject' then
      update public.dsr_historical_correction_requests set status='rejected',decided_at=statement_timestamp()
      where id=v_request.id returning * into v_request;
    else
      update public.dsr_historical_correction_requests
      set status='awaiting_second_approval',first_approved_by=v_user,first_approved_at=statement_timestamp()
      where id=v_request.id returning * into v_request;
    end if;
  elsif v_request.status='awaiting_second_approval' then
    if v_request.first_approved_by=v_user then raise exception 'A segunda aprovação deve ser feita por outro responsável.'; end if;
    if p_decision='reject' then
      update public.dsr_historical_correction_requests set status='rejected',decided_at=statement_timestamp()
      where id=v_request.id returning * into v_request;
    else
      update public.dsr_historical_correction_requests
      set status='approved',second_approved_by=v_user,second_approved_at=statement_timestamp(),decided_at=statement_timestamp()
      where id=v_request.id returning * into v_request;
    end if;
  else
    raise exception 'Esta solicitação já foi decidida.';
  end if;

  insert into public.dsr_historical_correction_decisions(request_id,organization_id,reviewer_user_id,decision,note)
  values(v_request.id,v_request.organization_id,v_user,p_decision,btrim(p_note));
  insert into public.audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,metadata)
  values(v_request.organization_id,v_user,'dsr_historical_correction_decided','dsr_historical_correction',v_request.id::text,
    jsonb_build_object('decision',p_decision,'status',v_request.status,'note',btrim(p_note)));

  return v_request;
end;
$function$;

revoke all on function public.request_dsr_historical_correction(text,uuid,jsonb,text) from public,anon;
revoke all on function public.decide_dsr_historical_correction(uuid,text,text) from public,anon;
grant execute on function public.request_dsr_historical_correction(text,uuid,jsonb,text) to authenticated;
grant execute on function public.decide_dsr_historical_correction(uuid,text,text) to authenticated;

create or replace view public.dsr_effective_employee_work_occurrences
with (security_invoker=true) as
select (jsonb_populate_record(o,r.proposed_snapshot)).*
from public.employee_work_occurrences o
left join lateral (
  select x.proposed_snapshot from public.dsr_historical_correction_requests x
  where x.organization_id=o.organization_id and x.target_type='occurrence'
    and x.target_id=o.id and x.status='approved'
  order by x.requested_at desc limit 1
) r on true;

create or replace view public.dsr_effective_employee_work_schedules
with (security_invoker=true) as
select (jsonb_populate_record(s,r.proposed_snapshot)).*
from public.employee_work_schedules s
left join lateral (
  select x.proposed_snapshot from public.dsr_historical_correction_requests x
  where x.organization_id=s.organization_id and x.target_type='schedule'
    and x.target_id=s.id and x.status='approved'
  order by x.requested_at desc limit 1
) r on true;

grant select on public.dsr_effective_employee_work_occurrences,public.dsr_effective_employee_work_schedules to authenticated;
