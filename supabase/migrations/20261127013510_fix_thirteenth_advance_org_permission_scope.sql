-- Keep the function definition aligned with the permission check used by this tenant.
-- This migration is idempotent: it accepts either the pre-fix or already-fixed body.
do $migration$
declare
  v_definition text;
  v_old text := 'private.has_org_permission(v_org, ''payroll.manage'')';
  v_new text := 'private.has_org_permission(p_organization_id, ''payroll.manage'')';
begin
  select pg_get_functiondef(
    'public.register_payroll_thirteenth_advance(uuid,uuid,integer,numeric,date,uuid,text)'::regprocedure
  ) into v_definition;

  if position(v_new in v_definition) > 0 then
    return;
  end if;

  if position(v_old in v_definition) = 0 then
    raise exception 'Expected permission check was not found; migration aborted.';
  end if;

  execute replace(v_definition, v_old, v_new);
end
$migration$;
