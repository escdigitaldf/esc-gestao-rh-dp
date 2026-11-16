-- Restrict DSR SECURITY DEFINER entry points and harden name resolution.
-- Trigger guard functions are internal implementation details: trigger execution
-- does not require callers to hold EXECUTE on the trigger function.
revoke execute on function public.guard_approved_dsr_occurrence_changes() from public, anon, authenticated;
revoke execute on function public.guard_approved_dsr_schedule_changes() from public, anon, authenticated;

-- These RPCs are intentionally callable by signed-in organization members.
-- Their bodies enforce auth.uid(), active membership, and role-level authorization.
revoke execute on function public.decide_dsr_competence_review(uuid, text, text) from public, anon;
grant execute on function public.decide_dsr_competence_review(uuid, text, text) to authenticated;

revoke execute on function public.decide_dsr_historical_correction(uuid, text, text) from public, anon;
grant execute on function public.decide_dsr_historical_correction(uuid, text, text) to authenticated;

revoke execute on function public.decide_employee_dsr_normative_assignment(uuid, text, text) from public, anon;
grant execute on function public.decide_employee_dsr_normative_assignment(uuid, text, text) to authenticated;

revoke execute on function public.reopen_dsr_competence_review(uuid, text) from public, anon;
grant execute on function public.reopen_dsr_competence_review(uuid, text) to authenticated;

revoke execute on function public.request_dsr_historical_correction(text, uuid, jsonb, text) from public, anon;
grant execute on function public.request_dsr_historical_correction(text, uuid, jsonb, text) to authenticated;

revoke execute on function public.request_employee_dsr_normative_assignment(uuid, uuid, uuid, text, text, text, date, date, text, text) from public, anon;
grant execute on function public.request_employee_dsr_normative_assignment(uuid, uuid, uuid, text, text, text, date, date, text, text) to authenticated;

revoke execute on function public.submit_dsr_competence_review(uuid, date, jsonb, text) from public, anon;
grant execute on function public.submit_dsr_competence_review(uuid, date, jsonb, text) to authenticated;

-- All relation references in these function bodies are schema-qualified;
-- an empty search_path prevents public-object shadowing in SECURITY DEFINER code.
alter function public.decide_employee_dsr_normative_assignment(uuid, text, text) set search_path = '';
alter function public.request_employee_dsr_normative_assignment(uuid, uuid, uuid, text, text, text, date, date, text, text) set search_path = '';

comment on function public.guard_approved_dsr_occurrence_changes() is
  'Internal DSR trigger guard. EXECUTE is revoked from API roles; invoke only through its trigger.';
comment on function public.guard_approved_dsr_schedule_changes() is
  'Internal DSR trigger guard. EXECUTE is revoked from API roles; invoke only through its trigger.';
