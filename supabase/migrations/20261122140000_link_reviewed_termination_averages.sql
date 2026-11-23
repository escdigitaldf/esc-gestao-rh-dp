-- Vínculo auditável entre uma média informativa revisada e a verba preliminar dela derivada.
-- O vínculo não valida a verba de destino nem executa cálculo legal.

alter table public.payroll_termination_calculation_items
  add column if not exists source_calculation_item_id uuid
  references public.payroll_termination_calculation_items(id) on delete restrict;

create unique index if not exists payroll_termination_items_source_once_idx
  on public.payroll_termination_calculation_items(source_calculation_item_id)
  where source_calculation_item_id is not null;

alter table public.payroll_termination_calculation_items
  drop constraint if exists payroll_termination_item_source_type_chk;
alter table public.payroll_termination_calculation_items
  add constraint payroll_termination_item_source_type_chk
  check (source_calculation_item_id is null or item_type = 'earning');

create or replace function public.validate_payroll_termination_item_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.payroll_termination_calculation_items%rowtype;
begin
  if new.source_calculation_item_id is null then
    return new;
  end if;

  if new.id = new.source_calculation_item_id then
    raise exception 'Um item não pode ser sua própria origem.';
  end if;

  select * into v_source
  from public.payroll_termination_calculation_items
  where id = new.source_calculation_item_id
  for key share;

  if not found
    or v_source.organization_id <> new.organization_id
    or v_source.termination_case_id <> new.termination_case_id
    or v_source.item_type <> 'information'
    or v_source.calculation_status <> 'reviewed'
    or v_source.item_code not like 'MEDIA_%' then
    raise exception 'A origem deve ser uma média informativa revisada do mesmo processo e organização.';
  end if;

  if tg_op = 'UPDATE' and old.source_calculation_item_id is distinct from new.source_calculation_item_id then
    raise exception 'A origem de um item derivado é imutável.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_payroll_termination_item_source_trigger
  on public.payroll_termination_calculation_items;
create trigger validate_payroll_termination_item_source_trigger
before insert or update of source_calculation_item_id, item_type, organization_id, termination_case_id
on public.payroll_termination_calculation_items
for each row execute function public.validate_payroll_termination_item_source();

comment on column public.payroll_termination_calculation_items.source_calculation_item_id is
'Origem informativa revisada de uma verba preliminar derivada. Relação única, imutável e restrita ao mesmo processo e organização.';
