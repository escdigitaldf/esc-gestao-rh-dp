-- Replace legacy role-name authorization inside privileged RPCs with
-- organization-scoped permission checks. Function bodies and business rules
-- remain unchanged; only the authorization predicates are updated.
DO $migration$
DECLARE
  r record;
  v_definition text;
  v_updated text;
  v_permission text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'decide_dsr_competence_review',
        'decide_dsr_historical_correction',
        'decide_employee_dsr_normative_assignment',
        'mark_payroll_thirteenth_advance_paid',
        'preview_payroll_employer_charges',
        'register_payroll_thirteenth_advance',
        'reopen_dsr_competence_review',
        'request_dsr_historical_correction',
        'request_employee_dsr_normative_assignment',
        'reverse_payroll_thirteenth_advance',
        'review_payroll_termination_calculation_item',
        'submit_dsr_competence_review',
        'validate_payroll_termination_case'
      )
  LOOP
    v_definition := pg_get_functiondef(r.oid);
    v_updated := v_definition;

    IF r.proname IN (
      'decide_dsr_competence_review',
      'decide_dsr_historical_correction',
      'decide_employee_dsr_normative_assignment',
      'request_dsr_historical_correction',
      'request_employee_dsr_normative_assignment',
      'submit_dsr_competence_review'
    ) THEN
      v_updated := replace(
        v_updated,
        $old$m.role in ('owner','admin','hr_manager','payroll')$old$,
        $new$private.has_org_permission(m.organization_id, 'payroll.manage')$new$
      );
    ELSIF r.proname = 'reopen_dsr_competence_review' THEN
      v_updated := replace(
        v_updated,
        $old$m.role in ('owner','admin')$old$,
        $new$private.has_org_permission(m.organization_id, 'organization.settings')$new$
      );
    ELSIF r.proname IN (
      'mark_payroll_thirteenth_advance_paid',
      'register_payroll_thirteenth_advance',
      'reverse_payroll_thirteenth_advance'
    ) THEN
      v_updated := replace(
        v_updated,
        $old$v_role is null or v_role not in ('owner','admin','hr_manager','payroll')$old$,
        $new$not private.has_org_permission(v_org, 'payroll.manage')$new$
      );
    ELSIF r.proname = 'preview_payroll_employer_charges' THEN
      v_updated := replace(
        v_updated,
        $old$v_role is null or v_role not in ('owner','admin','hr_manager','payroll')$old$,
        $new$not private.has_org_permission(v_org, 'payroll.charges.manage')$new$
      );
    ELSIF r.proname IN (
      'review_payroll_termination_calculation_item',
      'validate_payroll_termination_case'
    ) THEN
      v_updated := replace(
        v_updated,
        $old$m.role = any(array['owner','admin','hr_manager','payroll'])$old$,
        $new$private.has_org_permission(m.organization_id, 'payroll.termination.manage')$new$
      );
    END IF;

    IF v_updated = v_definition THEN
      RAISE EXCEPTION 'Authorization predicate not replaced in function %', r.proname;
    END IF;

    EXECUTE v_updated;
  END LOOP;
END;
$migration$;
