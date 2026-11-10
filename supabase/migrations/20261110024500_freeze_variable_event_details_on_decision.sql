-- Freeze all material event fields when the event is approved/rejected or processed.
create or replace function public.guard_payroll_variable_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_competence date;
begin
  if v_user_id is null then raise exception 'Sessão não autenticada.'; end if;
  if tg_op='INSERT' then v_org_id:=new.organization_id; v_competence:=new.competence;
  else v_org_id:=old.organization_id; v_competence:=old.competence; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org_id::text||':'||v_competence::text,0));

  if tg_op='INSERT' then
    if not exists(select 1 from public.organization_memberships m where m.organization_id=new.organization_id and m.user_id=v_user_id and m.status='active' and m.role in ('owner','admin','hr_manager','payroll')) then raise exception 'Usuário sem permissão para registrar eventos variáveis.'; end if;
    if new.status<>'pending' then raise exception 'Todo evento deve ser criado como pendente.'; end if;
    if exists(select 1 from public.payroll_runs r where r.organization_id=new.organization_id and r.reference_month=new.competence and r.status<>'cancelled') then raise exception 'A folha desta competência já foi gerada. Não é permitido incluir novos eventos.'; end if;
    new.approved_by:=null; new.approved_at:=null; new.processed_entry_id:=null; return new;
  end if;

  if old.status='approved' and new.status='processed' and coalesce(current_setting('app.payroll_event_processing',true),'')='on' then
    if new.processed_entry_id is null or new.organization_id<>old.organization_id or new.employee_id<>old.employee_id
      or new.rubric_id is distinct from old.rubric_id or new.competence<>old.competence or new.event_date is distinct from old.event_date
      or new.code<>old.code or new.description<>old.description or new.item_type<>old.item_type
      or new.quantity<>old.quantity or new.unit_value<>old.unit_value or new.affects_inss<>old.affects_inss
      or new.affects_irrf<>old.affects_irrf or new.affects_fgts<>old.affects_fgts or new.affects_dsr<>old.affects_dsr
      or new.notes is distinct from old.notes or new.created_by is distinct from old.created_by
      or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
      raise exception 'Dados do evento aprovado não podem ser alterados durante o processamento.';
    end if;
    return new;
  end if;

  if old.status<>'pending' then raise exception 'Eventos aprovados, rejeitados ou processados não podem ser alterados.'; end if;
  if exists(select 1 from public.payroll_runs r where r.organization_id=old.organization_id and r.reference_month=old.competence and r.status<>'cancelled') then raise exception 'A folha desta competência já foi gerada. Eventos pendentes não podem ser alterados ou aprovados.'; end if;
  if new.organization_id<>old.organization_id or new.employee_id<>old.employee_id or new.competence<>old.competence then raise exception 'Organização, colaborador e competência não podem ser alterados.'; end if;

  if new.status in ('approved','rejected') then
    if not exists(select 1 from public.organization_memberships m where m.organization_id=old.organization_id and m.user_id=v_user_id and m.status='active' and m.role in ('owner','admin','hr_manager','payroll')) then raise exception 'Somente DP ou administração pode decidir sobre eventos variáveis.'; end if;
    if new.code<>old.code or new.description<>old.description or new.item_type<>old.item_type or new.quantity<>old.quantity
      or new.unit_value<>old.unit_value or new.rubric_id is distinct from old.rubric_id or new.event_date is distinct from old.event_date
      or new.notes is distinct from old.notes or new.created_by is distinct from old.created_by
      or new.affects_inss<>old.affects_inss or new.affects_irrf<>old.affects_irrf
      or new.affects_fgts<>old.affects_fgts or new.affects_dsr<>old.affects_dsr then
      raise exception 'Os dados do evento não podem ser modificados durante a aprovação.';
    end if;
    new.approved_by:=v_user_id; new.approved_at:=now(); new.processed_entry_id:=null; return new;
  end if;
  if new.status<>'pending' then raise exception 'Transição de situação inválida para evento variável.'; end if;
  new.approved_by:=null; new.approved_at:=null; new.processed_entry_id:=null; return new;
end;
$function$;
