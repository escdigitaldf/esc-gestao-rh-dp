-- Permite atualizar observações e concluir férias já conferidas, preservando datas e valores auditados.
create or replace function public.prevent_reviewed_vacation_schedule_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
 if tg_op = 'DELETE' then
  if exists (
   select 1 from public.payroll_vacation_reviews r
   where r.organization_id=old.organization_id
     and r.vacation_schedule_id=old.id
     and r.status in ('reviewed','posted')
  ) then
   raise exception 'Esta programação já foi conferida na folha. Cancele a conferência por procedimento autorizado antes de excluir as férias.';
  end if;
  return old;
 end if;

 if (
   new.employee_id is distinct from old.employee_id
   or new.vacation_period_id is distinct from old.vacation_period_id
   or new.start_date is distinct from old.start_date
   or new.end_date is distinct from old.end_date
   or new.days is distinct from old.days
   or new.sold_days is distinct from old.sold_days
   or new.payment_date is distinct from old.payment_date
 ) and exists (
   select 1 from public.payroll_vacation_reviews r
   where r.organization_id=old.organization_id
     and r.vacation_schedule_id=old.id
     and r.status in ('reviewed','posted')
 ) then
  raise exception 'Esta programação já foi conferida na folha. Cancele a conferência por procedimento autorizado antes de alterar datas ou valores.';
 end if;
 return new;
end;
$$;
