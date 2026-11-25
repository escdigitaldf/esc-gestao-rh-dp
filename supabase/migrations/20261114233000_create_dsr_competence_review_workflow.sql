-- Formal, append-only DSR competence review workflow.
-- This records human attestations only; it never releases or calculates financial DSR.

create table if not exists public.dsr_competence_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  competence_month date not null,
  revision integer not null check (revision > 0),
  status text not null default 'awaiting_first_review'
    check (status in ('awaiting_first_review','awaiting_second_review','approved','rejected')),
  submitted_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz not null default statement_timestamp(),
  first_approved_by uuid references auth.users(id) on delete restrict,
  first_approved_at timestamptz,
  second_approved_by uuid references auth.users(id) on delete restrict,
  second_approved_at timestamptz,
  approved_at timestamptz,
  checklist_snapshot jsonb not null,
  blocker_count integer not null check (blocker_count >= 0),
  submission_note text not null check (length(btrim(submission_note)) >= 20),
  financial_calculation_released boolean not null default false check (financial_calculation_released = false),
  created_at timestamptz not null default statement_timestamp(),
  constraint dsr_competence_reviews_month_start check (extract(day from competence_month) = 1),
  constraint dsr_competence_reviews_revision_unique unique (organization_id, competence_month, revision),
  constraint dsr_competence_reviews_id_org_unique unique (id, organization_id)
);

create table if not exists public.dsr_competence_review_decisions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approve','reject')),
  note text not null check (length(btrim(note)) >= 20),
  created_at timestamptz not null default statement_timestamp(),
  constraint dsr_competence_review_decisions_review_fk
    foreign key (review_id, organization_id)
    references public.dsr_competence_reviews(id, organization_id) on delete restrict,
  constraint dsr_competence_review_decisions_one_per_reviewer unique (review_id, reviewer_user_id)
);

create index if not exists dsr_competence_reviews_org_month_idx
  on public.dsr_competence_reviews (organization_id, competence_month desc, revision desc);
create index if not exists dsr_competence_review_decisions_review_idx
  on public.dsr_competence_review_decisions (review_id, created_at);

alter table public.dsr_competence_reviews enable row level security;
alter table public.dsr_competence_review_decisions enable row level security;

drop policy if exists "dsr competence review members read" on public.dsr_competence_reviews;
create policy "dsr competence review members read"
  on public.dsr_competence_reviews for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists "dsr competence review decisions members read" on public.dsr_competence_review_decisions;
create policy "dsr competence review decisions members read"
  on public.dsr_competence_review_decisions for select to authenticated
  using (private.is_org_member(organization_id));

revoke insert, update, delete on public.dsr_competence_reviews from authenticated;
revoke insert, update, delete on public.dsr_competence_review_decisions from authenticated;
grant select on public.dsr_competence_reviews to authenticated;
grant select on public.dsr_competence_review_decisions to authenticated;

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
  if extract(day from p_competence_month) <> 1 then
    raise exception 'A competência deve ser informada pelo primeiro dia do mês.';
  end if;
  if jsonb_typeof(p_checklist_snapshot) <> 'array' or jsonb_array_length(p_checklist_snapshot) < 4 then
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
    where jsonb_typeof(item->'ok') <> 'boolean'
       or jsonb_typeof(item->'label') <> 'string'
  ) then
    raise exception 'Cada item do checklist deve conter resultado booleano.';
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

create or replace function public.decide_dsr_competence_review(
  p_review_id uuid,
  p_decision text,
  p_note text
)
returns public.dsr_competence_reviews
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_review public.dsr_competence_reviews%rowtype;
  v_next_status text;
begin
  if v_user is null then raise exception 'Autenticação obrigatória.'; end if;
  if coalesce(p_decision,'') not in ('approve','reject') then
    raise exception 'Decisão inválida.';
  end if;
  if length(btrim(coalesce(p_note,''))) < 20 then
    raise exception 'A justificativa da decisão deve conter ao menos 20 caracteres.';
  end if;

  select * into v_review
  from public.dsr_competence_reviews r
  where r.id = p_review_id
  for update;

  if not found then raise exception 'Conferência de competência não localizada.'; end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.organization_id = v_review.organization_id
      and m.user_id = v_user and m.status = 'active'
      and m.role in ('owner','admin','hr_manager','payroll')
  ) then
    raise exception 'Perfil sem permissão para decidir a conferência do DSR.';
  end if;

  if v_review.status not in ('awaiting_first_review','awaiting_second_review') then
    raise exception 'Esta conferência já recebeu decisão final.';
  end if;
  if v_review.blocker_count > 0 then
    raise exception 'A conferência possui pendências declaradas. Corrija-as e submeta nova revisão.';
  end if;

  if v_review.status = 'awaiting_first_review' then
    v_next_status := case when p_decision = 'approve' then 'awaiting_second_review' else 'rejected' end;
    update public.dsr_competence_reviews
    set status = v_next_status,
        first_approved_by = case when p_decision = 'approve' then v_user else null end,
        first_approved_at = case when p_decision = 'approve' then statement_timestamp() else null end
    where id = p_review_id returning * into v_review;
  else
    if v_user = v_review.first_approved_by then
      raise exception 'A segunda aprovação exige um responsável diferente do primeiro aprovador.';
    end if;
    v_next_status := case when p_decision = 'approve' then 'approved' else 'rejected' end;
    update public.dsr_competence_reviews
    set status = v_next_status,
        second_approved_by = case when p_decision = 'approve' then v_user else null end,
        second_approved_at = case when p_decision = 'approve' then statement_timestamp() else null end,
        approved_at = case when p_decision = 'approve' then statement_timestamp() else null end
    where id = p_review_id returning * into v_review;
  end if;

  insert into public.dsr_competence_review_decisions (
    review_id, organization_id, reviewer_user_id, decision, note
  ) values (
    v_review.id, v_review.organization_id, v_user, p_decision, btrim(p_note)
  );

  return v_review;
end;
$function$;

revoke all on function public.submit_dsr_competence_review(uuid,date,jsonb,text) from public;
revoke all on function public.decide_dsr_competence_review(uuid,text,text) from public;
grant execute on function public.submit_dsr_competence_review(uuid,date,jsonb,text) to authenticated;
grant execute on function public.decide_dsr_competence_review(uuid,text,text) to authenticated;
