-- Keep read-only training profiles able to view while restricting writes to managers.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['training_courses','training_events','training_participants'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_manage', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_manage_guard', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (private.has_org_permission(organization_id, ''training.manage''))', t||'_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (private.has_org_permission(organization_id, ''training.manage''))', t||'_insert_guard', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR UPDATE TO authenticated USING (private.has_org_permission(organization_id, ''training.manage'')) WITH CHECK (private.has_org_permission(organization_id, ''training.manage''))', t||'_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (private.has_org_permission(organization_id, ''training.manage'')) WITH CHECK (private.has_org_permission(organization_id, ''training.manage''))', t||'_update_guard', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR DELETE TO authenticated USING (private.has_org_permission(organization_id, ''training.manage''))', t||'_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (private.has_org_permission(organization_id, ''training.manage''))', t||'_delete_guard', t);
  END LOOP;
END $$;
