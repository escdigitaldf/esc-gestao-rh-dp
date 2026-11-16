create or replace function public.decide_employee_dsr_normative_assignment(p_assignment_id uuid,p_decision text,p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare v_row public.employee_dsr_normative_assignments%rowtype;
begin
 if auth.uid() is null then raise exception 'Autenticação obrigatória.'; end if;
 if p_decision is null or p_decision not in('validate','reject') or length(trim(coalesce(p_note,'')))<20 then raise exception 'Decisão inválida ou justificativa inferior a 20 caracteres.'; end if;
 select * into v_row from public.employee_dsr_normative_assignments where id=p_assignment_id for update;
 if not found then raise exception 'Solicitação não encontrada.'; end if;
 if not exists(select 1 from public.organization_memberships m where m.organization_id=v_row.organization_id and m.user_id=auth.uid() and m.status='active' and m.role in('owner','admin','hr_manager','payroll')) then raise exception 'Perfil sem permissão para decidir o enquadramento normativo.'; end if;
 if v_row.status<>'pending' then raise exception 'Somente solicitações pendentes podem ser decididas.'; end if;
 if v_row.created_by=auth.uid() then raise exception 'O solicitante não pode validar o próprio enquadramento.'; end if;
 if p_decision='validate' then
  if exists(select 1 from public.employee_dsr_normative_assignments a where a.organization_id=v_row.organization_id and a.employee_id=v_row.employee_id and a.id<>v_row.id and a.status='validated' and daterange(a.validity_from,coalesce(a.validity_to+1,'infinity'::date),'[)') && daterange(v_row.validity_from,coalesce(v_row.validity_to+1,'infinity'::date),'[)')) then raise exception 'Já existe enquadramento validado com vigência sobreposta para este colaborador.'; end if;
  if not exists(select 1 from public.organization_dsr_rules r where r.id=v_row.dsr_rule_id and r.organization_id=v_row.organization_id and r.status='validated' and r.validity_from<=v_row.validity_from and (r.validity_to is null or r.validity_to>=coalesce(v_row.validity_to,v_row.validity_from))) then raise exception 'A regra vinculada não está validada ou não cobre a vigência solicitada.'; end if;
  update public.employee_dsr_normative_assignments set status='validated',validated_by=auth.uid(),validated_at=now(),validation_note=trim(p_note),updated_at=now() where id=p_assignment_id;
 else
  update public.employee_dsr_normative_assignments set status='rejected',validated_by=auth.uid(),validated_at=now(),validation_note=trim(p_note),updated_at=now() where id=p_assignment_id;
 end if;
 insert into public.audit_logs(organization_id,actor_user_id,action,resource_type,resource_id,metadata) values(v_row.organization_id,auth.uid(),'employee_dsr_normative_assignment_'||p_decision,'employee_dsr_normative_assignment',p_assignment_id,jsonb_build_object('note',trim(p_note),'employee_id',v_row.employee_id));
end; $$;
revoke all on function public.decide_employee_dsr_normative_assignment(uuid,text,text) from public,anon;
grant execute on function public.decide_employee_dsr_normative_assignment(uuid,text,text) to authenticated;