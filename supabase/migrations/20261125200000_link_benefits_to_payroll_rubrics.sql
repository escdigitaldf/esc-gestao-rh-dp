-- Map benefit components to organization-owned payroll rubrics.
alter table public.benefit_types
 add column if not exists employee_deduction_rubric_id uuid,
 add column if not exists employer_cost_rubric_id uuid;
alter table public.benefit_types
 drop constraint if exists benefit_types_employee_deduction_rubric_fk,
 add constraint benefit_types_employee_deduction_rubric_fk
  foreign key(employee_deduction_rubric_id,organization_id)
  references public.payroll_rubrics(id,organization_id) on delete restrict,
 drop constraint if exists benefit_types_employer_cost_rubric_fk,
 add constraint benefit_types_employer_cost_rubric_fk
  foreign key(employer_cost_rubric_id,organization_id)
  references public.payroll_rubrics(id,organization_id) on delete restrict;
create or replace function public.guard_benefit_payroll_rubric_mapping()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare v_rubric public.payroll_rubrics%rowtype;
begin
 if new.employee_deduction_rubric_id is not null then
  select * into v_rubric from public.payroll_rubrics r
   where r.id=new.employee_deduction_rubric_id and r.organization_id=new.organization_id and r.active;
  if not found or v_rubric.item_type<>'deduction' then
   raise exception 'A rubrica de desconto deve ser ativa, do tipo desconto e da mesma organização.';
  end if;
  if v_rubric.affects_employer_inss is null or v_rubric.affects_rat is null
   or v_rubric.affects_third_parties is null or v_rubric.affects_payroll_pis is null then
   raise exception 'Classifique as incidências patronais da rubrica antes de vinculá-la ao benefício.';
  end if;
 end if;
 if new.employer_cost_rubric_id is not null then
  select * into v_rubric from public.payroll_rubrics r
   where r.id=new.employer_cost_rubric_id and r.organization_id=new.organization_id and r.active;
  if not found or v_rubric.item_type<>'employer_charge' then
   raise exception 'A rubrica de custo empresarial deve ser ativa, do tipo encargo patronal e da mesma organização.';
  end if;
  if v_rubric.affects_employer_inss is null or v_rubric.affects_rat is null
   or v_rubric.affects_third_parties is null or v_rubric.affects_payroll_pis is null then
   raise exception 'Classifique as incidências patronais da rubrica antes de vinculá-la ao benefício.';
  end if;
 end if;
 new.updated_at:=now();
 return new;
end;
$$;
drop trigger if exists trg_guard_benefit_payroll_rubric_mapping on public.benefit_types;
create trigger trg_guard_benefit_payroll_rubric_mapping
 before insert or update of employee_deduction_rubric_id,employer_cost_rubric_id,organization_id
 on public.benefit_types for each row execute function public.guard_benefit_payroll_rubric_mapping();
