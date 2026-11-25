
alter table public.payroll_variable_events
  add column if not exists affects_employer_inss boolean,
  add column if not exists affects_rat boolean,
  add column if not exists affects_third_parties boolean,
  add column if not exists affects_payroll_pis boolean;

alter table public.payroll_entry_items
  add column if not exists rubric_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.payroll_entry_items'::regclass and conname='payroll_entry_items_rubric_org_fk') then
    alter table public.payroll_entry_items add constraint payroll_entry_items_rubric_org_fk
      foreign key (rubric_id, organization_id) references public.payroll_rubrics(id, organization_id) on delete restrict;
  end if;
end $$;

create index if not exists payroll_entry_items_rubric_org_idx
  on public.payroll_entry_items(rubric_id, organization_id) where rubric_id is not null;

create or replace function public.snapshot_variable_event_employer_incidence()
returns trigger language plpgsql set search_path = '' as $$
declare v_rubric public.payroll_rubrics%rowtype;
begin
  if tg_op = 'INSERT' or new.rubric_id is distinct from old.rubric_id then
    if new.rubric_id is null then
      new.affects_employer_inss := null; new.affects_rat := null;
      new.affects_third_parties := null; new.affects_payroll_pis := null;
    else
      select * into v_rubric from public.payroll_rubrics r
      where r.id=new.rubric_id and r.organization_id=new.organization_id and r.active;
      if not found then raise exception 'Rubrica de origem inexistente, inativa ou de outra organização.'; end if;
      if v_rubric.affects_employer_inss is null or v_rubric.affects_rat is null
        or v_rubric.affects_third_parties is null or v_rubric.affects_payroll_pis is null then
        raise exception 'Classifique as quatro incidências patronais da rubrica antes de registrar o evento variável.';
      end if;
      new.affects_employer_inss := v_rubric.affects_employer_inss;
      new.affects_rat := v_rubric.affects_rat;
      new.affects_third_parties := v_rubric.affects_third_parties;
      new.affects_payroll_pis := v_rubric.affects_payroll_pis;
    end if;
  elsif old.status <> 'pending' and (
    new.affects_employer_inss is distinct from old.affects_employer_inss
    or new.affects_rat is distinct from old.affects_rat
    or new.affects_third_parties is distinct from old.affects_third_parties
    or new.affects_payroll_pis is distinct from old.affects_payroll_pis
  ) then raise exception 'As incidências patronais de evento decidido são imutáveis.';
  end if;
  return new;
end;
$$;

drop trigger if exists snapshot_variable_event_employer_incidence_trigger on public.payroll_variable_events;
create trigger snapshot_variable_event_employer_incidence_trigger
before insert or update on public.payroll_variable_events
for each row execute function public.snapshot_variable_event_employer_incidence();

create or replace function public.propagate_payroll_item_employer_incidence()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_event public.payroll_variable_events%rowtype;
  v_rubric public.payroll_rubrics%rowtype;
  v_employee_id uuid;
  v_matches integer;
begin
  if new.payroll_variable_event_id is not null then
    select * into v_event from public.payroll_variable_events e
    where e.id=new.payroll_variable_event_id and e.organization_id=new.organization_id and e.status='approved';
    if not found then raise exception 'Evento variável vinculado não está aprovado nesta organização.'; end if;
    select e.employee_id into v_employee_id from public.payroll_entries e
    where e.id=new.payroll_entry_id and e.organization_id=new.organization_id;
    if not found or v_employee_id is distinct from v_event.employee_id then
      raise exception 'O evento variável e o lançamento individual pertencem a colaboradores diferentes.';
    end if;
    new.rubric_id := v_event.rubric_id;
    new.affects_employer_inss := v_event.affects_employer_inss;
    new.affects_rat := v_event.affects_rat;
    new.affects_third_parties := v_event.affects_third_parties;
    new.affects_payroll_pis := v_event.affects_payroll_pis;
    return new;
  end if;
  if new.rubric_id is not null then
    select * into v_rubric from public.payroll_rubrics r
    where r.id=new.rubric_id and r.organization_id=new.organization_id and r.active;
    if not found then raise exception 'Rubrica vinculada ao item inexistente, inativa ou de outra organização.'; end if;
  else
    select count(*) into v_matches from public.payroll_rubrics r
    where r.organization_id=new.organization_id and r.code=new.code and r.item_type=new.item_type and r.active;
    if v_matches <> 1 then return new; end if;
    select * into v_rubric from public.payroll_rubrics r
    where r.organization_id=new.organization_id and r.code=new.code and r.item_type=new.item_type and r.active limit 1;
    new.rubric_id := v_rubric.id;
  end if;
  new.affects_employer_inss := v_rubric.affects_employer_inss;
  new.affects_rat := v_rubric.affects_rat;
  new.affects_third_parties := v_rubric.affects_third_parties;
  new.affects_payroll_pis := v_rubric.affects_payroll_pis;
  return new;
end;
$$;

drop trigger if exists propagate_payroll_item_employer_incidence_trigger on public.payroll_entry_items;
create trigger propagate_payroll_item_employer_incidence_trigger
before insert on public.payroll_entry_items
for each row execute function public.propagate_payroll_item_employer_incidence();

create or replace view public.payroll_item_employer_incidence_audit
with (security_invoker = true) as
select i.organization_id, i.id as payroll_entry_item_id, i.payroll_entry_id,
  e.employee_id, e.employee_code, e.employee_name, r.id as payroll_run_id,
  r.reference_month as competence, i.item_type, i.code, i.description,
  i.rubric_id, i.payroll_variable_event_id, pr.code as source_rubric_code,
  pr.description as source_rubric_description,
  pr.affects_employer_inss as rubric_affects_employer_inss,
  pr.affects_rat as rubric_affects_rat,
  pr.affects_third_parties as rubric_affects_third_parties,
  pr.affects_payroll_pis as rubric_affects_payroll_pis,
  i.affects_employer_inss, i.affects_rat, i.affects_third_parties,
  i.affects_payroll_pis, i.amount,
  case
    when i.payroll_variable_event_id is not null and i.rubric_id is null then 'event_without_source_rubric'
    when i.rubric_id is null then 'missing_source_rubric'
    when i.affects_employer_inss is null or i.affects_rat is null or i.affects_third_parties is null or i.affects_payroll_pis is null then 'item_incidence_unclassified'
    when i.affects_employer_inss is distinct from pr.affects_employer_inss
      or i.affects_rat is distinct from pr.affects_rat
      or i.affects_third_parties is distinct from pr.affects_third_parties
      or i.affects_payroll_pis is distinct from pr.affects_payroll_pis then 'item_incidence_differs_from_rubric'
    else 'classified'
  end as audit_status
from public.payroll_entry_items i
join public.payroll_entries e on e.id=i.payroll_entry_id and e.organization_id=i.organization_id
join public.payroll_runs r on r.id=e.payroll_run_id and r.organization_id=e.organization_id
left join public.payroll_rubrics pr on pr.id=i.rubric_id and pr.organization_id=i.organization_id;

grant select on public.payroll_item_employer_incidence_audit to authenticated;
revoke execute on function public.snapshot_variable_event_employer_incidence() from public, anon, authenticated;
revoke execute on function public.propagate_payroll_item_employer_incidence() from public, anon, authenticated;
