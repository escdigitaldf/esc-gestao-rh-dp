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
  elsif (old.status <> 'pending' or new.status <> 'pending') and (
    new.affects_employer_inss is distinct from old.affects_employer_inss
    or new.affects_rat is distinct from old.affects_rat
    or new.affects_third_parties is distinct from old.affects_third_parties
    or new.affects_payroll_pis is distinct from old.affects_payroll_pis
  ) then raise exception 'As incidências patronais de evento decidido são imutáveis.';
  end if;
  return new;
end;
$$;