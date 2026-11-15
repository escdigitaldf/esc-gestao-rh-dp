-- Tighten grants and reject malformed checklist rows in the DSR review RPC.

revoke all on table public.dsr_competence_reviews from public, anon, authenticated;
revoke all on table public.dsr_competence_review_decisions from public, anon, authenticated;
grant select on table public.dsr_competence_reviews to authenticated;
grant select on table public.dsr_competence_review_decisions to authenticated;

create or replace function public.submit_dsr_competence_review(
  p_organization_id uuid,
  p_competence_month date,
  p_checklist_snapshot jsonb,
  p_submission_note text
)
returns public.dsr_competence_reviews
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_revision integer;
  v_blockers integer;
  v_review public.dsr_competence_reviews%rowtype;
  v_latest_status text;
begin
  if v_user is null then raise exception 'Autenticação obrigatória.'; end if;
  if p_competence_month is null or extract(day from p_competence_month) <> 1 then
    raise exception 'A competência deve ser informada pelo primeiro dia do mês.';
  end if;
  if p_checklist_snapshot is null
     or jsonb_typeof(p_checklist_snapshot) <> 'array'
     or jsonb_array_length(p_checklist_snapshot) < 4 then
    raise exception 'O checklist deve conter ao menos quatro verificações.';
  end if;
  if length(btrim(coalesce(p_submission_note,''))) < 20 then
    raise exception 'A observação de envio deve conter ao menos 20 caracteres.';
  end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = v_user and m.status = 'active'
      and m.role in ('owner','admin','hr_manager','payroll')
  ) then
    raise exception 'Perfil sem permissão para submeter a conferência do DSR.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_checklist_snapshot) as elements(item)
    where jsonb_typeof(item->'ok') is distinct from 'boolean'
       or jsonb_typeof(item->'label') is distinct from 'string'
  ) then
    raise exception 'Cada item do checklist deve conter rótulo e resultado booleano.';
  end if;

  select count(*)::integer into v_blockers
  from jsonb_array_elements(p_checklist_snapshot) as elements(item)
  where (item->>'ok')::boolean is false;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_competence_month::text, 0));

  select status into v_latest_status
  from public.dsr_competence_reviews
  where organization_id = p_organization_id and competence_month = p_competence_month
  order by revision desc limit 1;

  if v_latest_status is not null and v_latest_status <> 'rejected' then
    raise exception 'Já existe uma conferência ativa ou aprovada para esta competência.';
  end if;

  select coalesce(max(revision),0) + 1 into v_revision
  from public.dsr_competence_reviews
  where organization_id = p_organization_id and competence_month = p_competence_month;

  insert into public.dsr_competence_reviews (
    organization_id, competence_month, revision, submitted_by,
    checklist_snapshot, blocker_count, submission_note
  ) values (
    p_organization_id, p_competence_month, v_revision, v_user,
    p_checklist_snapshot, v_blockers, btrim(p_submission_note)
  ) returning * into v_review;

  return v_review;
end;
$function$;

revoke all on function public.submit_dsr_competence_review(uuid,date,jsonb,text) from public;
revoke all on function public.decide_dsr_competence_review(uuid,text,text) from public;
grant execute on function public.submit_dsr_competence_review(uuid,date,jsonb,text) to authenticated;
grant execute on function public.decide_dsr_competence_review(uuid,text,text) to authenticated;
