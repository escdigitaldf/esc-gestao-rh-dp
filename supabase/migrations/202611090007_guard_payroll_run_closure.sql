-- Protege o fechamento da folha no banco, inclusive contra atualizações concorrentes.
-- Mantém as regras existentes e acrescenta validação de conferência de lançamentos e férias.

create or replace function public.prevent_closed_payroll_changes()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_run_id uuid;
  v_entry_id uuid;
  v_run_status text;
  v_period_start date;
  v_period_end date;
begin
  if tg_table_name = 'payroll_runs' then
    if tg_op = 'DELETE' then
      if old.status = 'closed' then
        raise exception 'Competência fechada não pode ser excluída.';
      end if;
      return old;
    end if;

    if old.status = 'closed' then
      raise exception 'Competência fechada não pode ser alterada.';
    end if;

    if new.status = 'closed' and old.status is distinct from 'closed' then
      if old.status = 'cancelled' then
        raise exception 'Uma competência cancelada não pode ser fechada.';
      end if;

      if not exists (
        select 1
        from public.payroll_entries e
        where e.payroll_run_id = new.id
          and e.organization_id = new.organization_id
      ) then
        raise exception 'Não é possível fechar uma folha sem lançamentos individuais.';
      end if;

      if exists (
        select 1
        from public.payroll_entries e
        where e.payroll_run_id = new.id
          and e.organization_id = new.organization_id
          and e.status not in ('reviewed', 'paid')
      ) then
        raise exception 'Não é possível fechar a folha: existem lançamentos individuais não conferidos.';
      end if;

      v_period_start := date_trunc('month', new.reference_month)::date;
      v_period_end := (v_period_start + interval '1 month' - interval '1 day')::date;

      if exists (
        select 1
        from public.employee_vacation_schedules s
        where s.organization_id = new.organization_id
          and s.status = 'approved'
          and (
            (s.payment_date between v_period_start and v_period_end)
            or (
              s.payment_date is null
              and s.start_date between v_period_start and v_period_end
            )
          )
          and not exists (
            select 1
            from public.payroll_vacation_reviews r
            where r.organization_id = new.organization_id
              and r.vacation_schedule_id = s.id
              and r.payroll_run_id = new.id
              and r.employee_id = s.employee_id
              and r.status = 'reviewed'
          )
      ) then
        raise exception 'Não é possível fechar a folha: existem férias aprovadas sem conferência vinculada a esta competência.';
      end if;

      new.closed_at := coalesce(new.closed_at, now());
    end if;

    return new;
  end if;

  if tg_table_name = 'payroll_entries' then
    if tg_op = 'UPDATE'
       and (
         new.payroll_run_id is distinct from old.payroll_run_id
         or new.organization_id is distinct from old.organization_id
       ) then
      raise exception 'Não é permitido transferir um lançamento entre competências ou organizações.';
    end if;

    if tg_op = 'DELETE' then
      v_run_id := old.payroll_run_id;
    else
      v_run_id := new.payroll_run_id;
    end if;
  else
    if tg_op = 'UPDATE'
       and (
         new.payroll_entry_id is distinct from old.payroll_entry_id
         or new.organization_id is distinct from old.organization_id
       ) then
      raise exception 'Não é permitido transferir uma rubrica entre lançamentos ou organizações.';
    end if;

    if tg_op = 'DELETE' then
      v_entry_id := old.payroll_entry_id;
    else
      v_entry_id := new.payroll_entry_id;
    end if;

    select e.payroll_run_id
      into v_run_id
    from public.payroll_entries e
    where e.id = v_entry_id
      and e.organization_id = case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  end if;

  -- Serializa qualquer alteração filha com o fechamento da respectiva competência.
  select r.status
    into v_run_status
  from public.payroll_runs r
  where r.id = v_run_id
  for update;

  if v_run_status = 'closed' then
    raise exception 'Não é permitido alterar lançamentos de uma competência fechada.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;
