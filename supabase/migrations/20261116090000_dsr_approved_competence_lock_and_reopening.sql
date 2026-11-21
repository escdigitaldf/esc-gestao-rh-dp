-- Reabertura excepcional e bloqueio retroativo de competências DSR aprovadas.
alter table public.dsr_competence_reviews
  drop constraint if exists dsr_competence_reviews_status_check;
alter table public.dsr_competence_reviews
  add constraint dsr_competence_reviews_status_check
  check (status = any (array[
    'awaiting_first_review'::text,
    'awaiting_second_review'::text,
    'approved'::text,
    'rejected'::text,
    'reopened'::text
  ]));

create table if not exists public.dsr_competence_review_reopenings (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null,
  organization_id uuid not null,
  reopened_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (length(btrim(reason)) >= 20),
  created_at timestamptz not null default statement_timestamp(),
  constraint dsr_competence_review_reopenings_review_fk
    foreign key (review_id, organization_id)
    references public.dsr_competence_reviews(id, organization_id) on delete restrict,
  constraint dsr_competence_review_reopenings_once unique (review_id)
);

alter table public.dsr_competence_review_reopenings enable row level security;
revoke all on public.dsr_competence_review_reopenings from public, anon, authenticated;
grant select on public.dsr_competence_review_reopenings to authenticated;
drop policy if exists dsr_competence_review_reopenings_select_member on public.dsr_competence_review_reopenings;
create policy dsr_competence_review_reopenings_select_member
on public.dsr_competence_review_reopenings
for select to authenticated
using (exists (
  select 1 from public.organization_memberships m
  where m.organization_id = dsr_competence_review_reopenings.organization_id
    and m.user_id = (select auth.uid()) and m.status = 'active'
));

create or replace function public.guard_dsr_competence_review_reopening()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'O histórico de reabertura é imutável.';
end;
$function$;

drop trigger if exists trg_guard_dsr_competence_review_reopening on public.dsr_competence_review_reopenings;
create trigger trg_guard_dsr_competence_review_reopening
before update or delete on public.dsr_competence_review_reopenings
for each row execute function public.guard_dsr_competence_review_reopening();

create or replace function public.guard_approved_dsr_occurrence_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org uuid;
  v_date date;
begin
  if tg_op <> 'INSERT' then
    v_org := old.organization_id;
    v_date := old.occurrence_date;
    if exists (
      select 1 from public.dsr_competence_reviews r
      where r.organization_id = v_org
        and r.competence_month = date_trunc('month', v_date)::date
        and r.status = 'approved'
    ) then
      raise exception 'Competência DSR aprovada: ocorrência bloqueada. Solicite reabertura administrativa antes de qualquer alteração.';
    end if;
  end if;

  if tg_op <> 'DELETE' then
    v_org := new.organization_id;
    v_date := new.occurrence_date;
    if exists (
      select 1 from public.dsr_competence_reviews r
      where r.organization_id = v_org
        and r.competence_month = date_trunc('month', v_date)::date
        and r.status = 'approved'
    ) then
      raise exception 'Competência DSR aprovada: ocorrência bloqueada. Solicite reabertura administrativa antes de qualquer alteração.';
    end if;
    return new;
  end if;
  return old;
end;
$function$;

drop trigger if exists aaa_guard_approved_dsr_occurrence_changes on public.employee_work_occurrences;
create trigger aaa_guard_approved_dsr_occurrence_changes
before insert or update or delete on public.employee_work_occurrences
for each row execute function public.guard_approved_dsr_occurrence_changes();

create or replace function public.guard_approved_dsr_schedule_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org uuid;
  v_from date;
  v_to date;
begin
  if tg_op <> 'INSERT' then
    v_org := old.organization_id;
    v_from := old.effective_from;
    v_to := old.effective_to;
    if exists (
      select 1 from public.dsr_competence_reviews r
      where r.organization_id = v_org
        and r.status = 'approved'
        and v_from <= (r.competence_month + interval '1 month - 1 day')::date
        and coalesce(v_to, 'infinity'::date) >= r.competence_month
    ) and (
      tg_op = 'DELETE'
      or new.employee_id is distinct from old.employee_id
      or new.schedule_name is distinct from old.schedule_name
      or new.schedule_type is distinct from old.schedule_type
      or new.effective_from is distinct from old.effective_from
      or new.effective_to is distinct from old.effective_to
      or new.work_days is distinct from old.work_days
      or new.weekly_rest_days is distinct from old.weekly_rest_days
      or new.weekly_hours is distinct from old.weekly_hours
      or new.cycle_days is distinct from old.cycle_days
      or new.cycle_pattern is distinct from old.cycle_pattern
      or new.dsr_rule_id is distinct from old.dsr_rule_id
      or new.dsr_rule_status is distinct from old.dsr_rule_status
    ) then
      raise exception 'Competência DSR aprovada: escala histórica bloqueada. Solicite reabertura administrativa antes de qualquer alteração.';
    end if;
  end if;

  if tg_op <> 'DELETE' then
    v_org := new.organization_id;
    v_from := new.effective_from;
    v_to := new.effective_to;
    if exists (
      select 1 from public.dsr_competence_reviews r
      where r.organization_id = v_org
        and r.status = 'approved'
        and v_from <= (r.competence_month + interval '1 month - 1 day')::date
        and coalesce(v_to, 'infinity'::date) >= r.competence_month
    ) and (
      tg_op = 'INSERT'
      or new.employee_id is distinct from old.employee_id
      or new.schedule_name is distinct from old.schedule_name
      or new.schedule_type is distinct from old.schedule_type
      or new.effective_from is distinct from old.effective_from
      or new.effective_to is distinct from old.effective_to
      or new.work_days is distinct from old.work_days
      or new.weekly_rest_days is distinct from old.weekly_rest_days
      or new.weekly_hours is distinct from old.weekly_hours
      or new.cycle_days is distinct from old.cycle_days
      or new.cycle_pattern is distinct from old.cycle_pattern
      or new.dsr_rule_id is distinct from old.dsr_rule_id
      or new.dsr_rule_status is distinct from old.dsr_rule_status
    ) then
      raise exception 'Competência DSR aprovada: não é permitido inserir ou alterar escala com vigência retroativa. Solicite reabertura administrativa.';
    end if;
    return new;
  end if;
  return old;
end;
$function$;

drop trigger if exists aaa_guard_approved_dsr_schedule_changes on public.employee_work_schedules;
create trigger aaa_guard_approved_dsr_schedule_changes
before insert or update or delete on public.employee_work_schedules
for each row execute function public.guard_approved_dsr_schedule_changes();

create or replace function public.reopen_dsr_competence_review(
  p_review_id uuid,
  p_reason text
)
returns public.dsr_competence_reviews
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_review public.dsr_competence_reviews%rowtype;
begin
  if v_user is null then raise exception 'Autenticação obrigatória.'; end if;
  if length(btrim(coalesce(p_reason,''))) < 20 then
    raise exception 'A justificativa de reabertura deve conter ao menos 20 caracteres.';
  end if;

  select * into v_review
  from public.dsr_competence_reviews
  where id = p_review_id
  for update;

  if not found then raise exception 'Revisão de competência não encontrada.'; end if;
  if v_review.status <> 'approved' then
    raise exception 'Somente uma competência aprovada pode ser reaberta.';
  end if;

  if not exists (
    select 1 from public.organization_memberships m
    where m.organization_id = v_review.organization_id
      and m.user_id = v_user and m.status = 'active'
      and m.role in ('owner','admin')
  ) then
    raise exception 'Somente owner ou admin pode autorizar a reabertura excepcional.';
  end if;

  update public.dsr_competence_reviews
  set status = 'reopened'
  where id = v_review.id
  returning * into v_review;

  insert into public.dsr_competence_review_reopenings
    (review_id, organization_id, reopened_by, reason)
  values
    (v_review.id, v_review.organization_id, v_user, btrim(p_reason));

  insert into public.audit_logs
    (organization_id, actor_user_id, action, resource_type, resource_id, metadata)
  values
    (v_review.organization_id, v_user, 'dsr_competence_review_reopened',
     'dsr_competence_review', v_review.competence_month::text,
     jsonb_build_object('review_id', v_review.id, 'revision', v_review.revision, 'reason', btrim(p_reason)));

  return v_review;
end;
$function$;

revoke all on function public.reopen_dsr_competence_review(uuid,text) from public, anon;
grant execute on function public.reopen_dsr_competence_review(uuid,text) to authenticated;

create or replace function public.submit_dsr_competence_review(
  p_organization_id uuid,
  p_competence_month date,
  p_checklist_snapshot jsonb,
  p_submission_note text
)
returns public.dsr_competence_reviews
language plpgsql
security definer
set search_path = ''
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

  if v_latest_status is not null and v_latest_status not in ('rejected','reopened') then
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

revoke all on function public.submit_dsr_competence_review(uuid,date,jsonb,text) from public, anon;
grant execute on function public.submit_dsr_competence_review(uuid,date,jsonb,text) to authenticated;
