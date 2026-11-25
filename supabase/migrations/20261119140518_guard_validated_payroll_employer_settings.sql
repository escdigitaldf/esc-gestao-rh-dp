-- Validated employer tax settings are immutable. New effective periods require a new version.
create or replace function public.guard_validated_payroll_employer_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' and OLD.status = 'validated' then
    raise exception 'Enquadramento patronal validado é imutável. Preserve o histórico e cadastre uma nova versão para alterações.';
  end if;
  if TG_OP = 'UPDATE' and OLD.status = 'validated' then
    raise exception 'Enquadramento patronal validado é imutável. Preserve o histórico e cadastre uma nova versão para alterações.';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

drop trigger if exists guard_validated_payroll_employer_settings_trigger on public.organization_payroll_employer_settings;
create trigger guard_validated_payroll_employer_settings_trigger
before update or delete on public.organization_payroll_employer_settings
for each row execute function public.guard_validated_payroll_employer_settings();

revoke execute on function public.guard_validated_payroll_employer_settings() from public, anon, authenticated;
