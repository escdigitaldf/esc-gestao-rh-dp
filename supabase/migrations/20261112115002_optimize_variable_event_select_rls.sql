DROP POLICY IF EXISTS payroll_variable_events_member_select ON public.payroll_variable_events;

CREATE POLICY payroll_variable_events_member_select
ON public.payroll_variable_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.organization_id = payroll_variable_events.organization_id
      AND m.user_id = (SELECT auth.uid())
      AND m.status = 'active'
  )
);
