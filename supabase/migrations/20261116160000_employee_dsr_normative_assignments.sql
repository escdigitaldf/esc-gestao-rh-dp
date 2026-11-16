create table if not exists public.employee_dsr_normative_assignments (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 employee_id uuid not null, dsr_rule_id uuid not null, professional_category text not null check(length(trim(professional_category))>=2),
 collective_instrument text not null check(length(trim(collective_instrument))>=3), work_regime text not null check(length(trim(work_regime))>=2),
 validity_from date not null, validity_to date, source_reference text not null check(length(trim(source_reference))>=3),
 justification text not null check(length(trim(justification))>=20), status text not null default 'pending' check(status in ('pending','validated','rejected')),
 validated_by uuid, validated_at timestamptz, validation_note text, created_by uuid not null default auth.uid(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint employee_dsr_normative_assignment_dates check(validity_to is null or validity_to>=validity_from),
 constraint employee_dsr_normative_assignment_employee_fk foreign key(employee_id,organization_id) references public.employees(id,organization_id) on delete cascade,
 constraint employee_dsr_normative_assignment_rule_fk foreign key(dsr_rule_id,organization_id) references public.organization_dsr_rules(id,organization_id) on delete restrict
);
create index if not exists idx_employee_dsr_normative_assignments_lookup on public.employee_dsr_normative_assignments(organization_id,employee_id,validity_from,validity_to);
create index if not exists idx_employee_dsr_normative_assignments_rule on public.employee_dsr_normative_assignments(organization_id,dsr_rule_id,status);
alter table public.employee_dsr_normative_assignments enable row level security;
revoke all on public.employee_dsr_normative_assignments from public,anon,authenticated;
grant select on public.employee_dsr_normative_assignments to authenticated;
drop policy if exists employee_dsr_normative_assignments_select on public.employee_dsr_normative_assignments;
create policy employee_dsr_normative_assignments_select on public.employee_dsr_normative_assignments for select to authenticated using(exists(select 1 from public.organization_memberships m where m.organization_id=employee_dsr_normative_assignments.organization_id and m.user_id=auth.uid() and m.status='active'));
create or replace function public.request_employee_dsr_normative_assignment(p_organization_id uuid,p_employee_id uuid,p_dsr_rule_id uuid,p_professional_category text,p_collective_instrument text,p_work_regime text,p_validity_from date,p_validity_to date,p_source_reference text,p_justification text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 if auth.uid() is null then raise exception 'Autenticação obrigatória.'; end if;
 if length(trim(coalesce(p_professional_category,'')))<2 or length(trim(coalesce(p_collective_instrument,'')))<3 or length(trim(coalesce(p_work_regime,'')))<2 or p_validity_from is null or (p_validity_to is not null and p_validity_to<p_validity_from) or length(trim(coalesce(p_source_reference,'')))<3 or length(trim(coalesce(p_justification,'')))<20 then raise exception 'Preencha categoria, instrumento coletivo, regime, vigência, fonte e justificativa válida.'; end if;
 if not exists(select 1 from public.organization_memberships m where m.organization_id=p_organization_id and m.user_id=auth.uid() and m.status='active' and m.role in('owner','admin','hr_manager','payroll')) then raise exception 'Perfil sem permissão para solicitar o enquadramento normativo.'; end if;
 if not exists(select 1 from public.employees e where e.id=p_employee_id and e.organization_id=p_organization_id) then raise exception 'Colaborador não pertence à organização informada.'; end if;
 if not exists(select 1 from public.organization_dsr_rules r where r.id=p_dsr_rule_id and r.organization_id=p_organization_id) then raise exception 'Regra normativa não pertence à organização informada.'; end if;
 if exists(select 1 from public.employee_dsr_normative_assignments a where a.organization_id=p_organization_id and a.employee_id=p_employee_id and a.status='pending' and daterange(a.validity_from,coalesce(a.validity_to+1,'infinity'::date),'[)') && daterange(p_validity_from,coalesce(p_validity_to+1,'infinity'::date),'[)')) then raise exception 'Já existe solicitação pendente com vigência sobreposta para este colaborador.'; end if;
 insert into public.employee_dsr_normative_assignments(organization_id,employee_id,dsr_rule_id,professional_category,collective_instrument,work_regime,validity_from,validity_to,source_reference,justification,status,created_by) values(p_organization_id,p_employee_id,p_dsr_rule_id,trim(p_professional_category),trim(p_collective_instrument),trim(p_work_regime),p_validity_from,p_validity_to,trim(p_source_reference),trim(p_justification),'pending',auth.uid()) returning id into v_id;
 insert into public.audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,metadata) values(p_organization_id,auth.uid(),'employee_dsr_normative_assignment_requested','employee_dsr_normative_assignment',v_id,jsonb_build_object('employee_id',p_employee_id,'dsr_rule_id',p_dsr_rule_id,'validity_from',p_validity_from,'validity_to',p_validity_to));
 return v_id;
end; $$;
create or replace function public.decide_employee_dsr_normative_assignment(p_assignment_id uuid,p_decision text,p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare v_row public.employee_dsr_normative_assignments%rowtype;
begin
 if auth.uid() is null then raise exception 'Autenticação obrigatória.'; end if;
 if p_decision not in('validate','reject') or length(trim(coalesce(p_note,'')))<20 then raise exception 'Decisão inválida ou justificativa inferior a 20 caracteres.'; end if;
 select * into v_row from public.employee_dsr_normative_assignments where id=p_assignment_id for update;
 if not found then raise exception 'Solicitação não encontrada.'; end if;
 if not exists(select 1 from public.organization_memberships m where m.organization_id=v_row.organization_id and m.user_id=auth.uid() and m.status='active' and m.role in('owner','admin','hr_manager','payroll')) then raise exception 'Perfil sem permissão para decidir o enquadramento normativo.'; end if;
 if v_row.status<>'pending' then raise exception 'Somente solicitações pendentes podem ser decididas.'; end if;
 if v_row.created_by=auth.uid() then raise exception 'O solicitante não pode validar o próprio enquadramento.'; end if;
 if p_decision='validate' then
  if not exists(select 1 from public.organization_dsr_rules r where r.id=v_row.dsr_rule_id and r.organization_id=v_row.organization_id and r.status='validated' and r.validity_from<=v_row.validity_from and (r.validity_to is null or r.validity_to>=coalesce(v_row.validity_to,v_row.validity_from))) then raise exception 'A regra vinculada não está validada ou não cobre a vigência solicitada.'; end if;
  update public.employee_dsr_normative_assignments set status='validated',validated_by=auth.uid(),validated_at=now(),validation_note=trim(p_note),updated_at=now() where id=p_assignment_id;
 else
  update public.employee_dsr_normative_assignments set status='rejected',validated_by=auth.uid(),validated_at=now(),validation_note=trim(p_note),updated_at=now() where id=p_assignment_id;
 end if;
 insert into public.audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,metadata) values(v_row.organization_id,auth.uid(),'employee_dsr_normative_assignment_'||p_decision,'employee_dsr_normative_assignment',p_assignment_id,jsonb_build_object('note',trim(p_note),'employee_id',v_row.employee_id));
end; $$;
revoke all on function public.request_employee_dsr_normative_assignment(uuid,uuid,uuid,text,text,text,date,date,text,text) from public,anon;
revoke all on function public.decide_employee_dsr_normative_assignment(uuid,text,text) from public,anon;
grant execute on function public.request_employee_dsr_normative_assignment(uuid,uuid,uuid,text,text,text,date,date,text,text) to authenticated;
grant execute on function public.decide_employee_dsr_normative_assignment(uuid,text,text) to authenticated;