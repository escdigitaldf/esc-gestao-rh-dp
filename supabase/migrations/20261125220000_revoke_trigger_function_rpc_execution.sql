-- Trigger functions are invoked by their triggers and must not be exposed as RPCs.
revoke all on function public.audit_payroll_employer_charge_guide_value() from public, anon, authenticated;
revoke all on function public.audit_payroll_statutory_guide_value() from public, anon, authenticated;
revoke all on function public.audit_payroll_termination_calculation_item() from public, anon, authenticated;
revoke all on function public.audit_payroll_termination_case() from public, anon, authenticated;
revoke all on function public.guard_payroll_termination_case_validation() from public, anon, authenticated;
revoke all on function public.guard_payroll_termination_item_validation() from public, anon, authenticated;
revoke all on function public.prepare_payroll_termination_case_audit() from public, anon, authenticated;
revoke all on function public.prepare_payroll_termination_item_audit() from public, anon, authenticated;
revoke all on function public.protect_linked_termination_average_source() from public, anon, authenticated;
revoke all on function public.record_payroll_termination_case_audit() from public, anon, authenticated;
revoke all on function public.record_payroll_termination_item_audit() from public, anon, authenticated;
revoke all on function public.validate_payroll_termination_item_source() from public, anon, authenticated;
