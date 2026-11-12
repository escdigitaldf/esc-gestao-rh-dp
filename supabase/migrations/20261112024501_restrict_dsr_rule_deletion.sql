revoke all on table public.organization_dsr_rules from anon, authenticated, public;
grant select, insert, update on table public.organization_dsr_rules to authenticated;

drop trigger if exists guard_organization_dsr_rule_delete
  on public.organization_dsr_rules;
create trigger guard_organization_dsr_rule_delete
  before delete on public.organization_dsr_rules
  for each row execute function public.guard_organization_dsr_rule();
