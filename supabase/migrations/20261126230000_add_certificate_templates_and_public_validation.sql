-- Event certification: editable templates, external attendees and public authenticity verification.
CREATE TABLE IF NOT EXISTS public.training_certificate_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  title text NOT NULL DEFAULT 'Certificado',
  issuer_name text,
  issuer_document text,
  primary_color text NOT NULL DEFAULT '#172554' CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text NOT NULL DEFAULT '#b38a42' CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  border_style text NOT NULL DEFAULT 'double' CHECK (border_style IN ('solid','double','none')),
  signature_label text NOT NULL DEFAULT 'Responsável pela capacitação',
  logo_storage_path text,
  background_storage_path text,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS training_certificate_one_default_per_org
  ON public.training_certificate_templates(organization_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS training_certificate_templates_org_idx
  ON public.training_certificate_templates(organization_id, is_active);
ALTER TABLE public.training_participants
  ALTER COLUMN employee_id DROP NOT NULL;
ALTER TABLE public.training_participants
  ADD COLUMN IF NOT EXISTS external_name text,
  ADD COLUMN IF NOT EXISTS external_email text,
  ADD COLUMN IF NOT EXISTS external_organization text,
  ADD COLUMN IF NOT EXISTS certificate_verification_token uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS certificate_template_id uuid;
ALTER TABLE public.training_participants
  DROP CONSTRAINT IF EXISTS training_participants_external_identity_check;
ALTER TABLE public.training_participants
  ADD CONSTRAINT training_participants_external_identity_check
  CHECK ((employee_id IS NOT NULL) OR (length(trim(coalesce(external_name,''))) >= 2));
ALTER TABLE public.training_participants
  DROP CONSTRAINT IF EXISTS training_participants_certificate_template_org_fk;
ALTER TABLE public.training_participants
  ADD CONSTRAINT training_participants_certificate_template_org_fk
  FOREIGN KEY (certificate_template_id, organization_id)
  REFERENCES public.training_certificate_templates(id, organization_id)
  ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS training_participants_certificate_token_unique
  ON public.training_participants(certificate_verification_token)
  WHERE certificate_verification_token IS NOT NULL;
UPDATE public.training_participants
SET certificate_verification_token = gen_random_uuid()
WHERE certificate_storage_path IS NOT NULL AND certificate_verification_token IS NULL;
CREATE OR REPLACE FUNCTION public.ensure_training_certificate_token()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.certificate_storage_path IS NOT NULL AND NEW.certificate_verification_token IS NULL THEN
    NEW.certificate_verification_token := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS training_certificate_token_guard ON public.training_participants;
CREATE TRIGGER training_certificate_token_guard
BEFORE INSERT OR UPDATE OF certificate_storage_path, certificate_verification_token
ON public.training_participants
FOR EACH ROW EXECUTE FUNCTION public.ensure_training_certificate_token();
ALTER TABLE public.training_certificate_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS training_certificate_templates_read ON public.training_certificate_templates;
DROP POLICY IF EXISTS training_certificate_templates_read_guard ON public.training_certificate_templates;
DROP POLICY IF EXISTS training_certificate_templates_manage ON public.training_certificate_templates;
DROP POLICY IF EXISTS training_certificate_templates_manage_guard ON public.training_certificate_templates;
DROP POLICY IF EXISTS training_certificate_templates_insert ON public.training_certificate_templates;
DROP POLICY IF EXISTS training_certificate_templates_insert_guard ON public.training_certificate_templates;
DROP POLICY IF EXISTS training_certificate_templates_update ON public.training_certificate_templates;
DROP POLICY IF EXISTS training_certificate_templates_update_guard ON public.training_certificate_templates;
DROP POLICY IF EXISTS training_certificate_templates_delete ON public.training_certificate_templates;
DROP POLICY IF EXISTS training_certificate_templates_delete_guard ON public.training_certificate_templates;
CREATE POLICY training_certificate_templates_read ON public.training_certificate_templates AS PERMISSIVE FOR SELECT TO authenticated USING (private.has_org_permission(organization_id,'training.view'));
CREATE POLICY training_certificate_templates_read_guard ON public.training_certificate_templates AS RESTRICTIVE FOR SELECT TO authenticated USING (private.has_org_permission(organization_id,'training.view'));
CREATE POLICY training_certificate_templates_insert ON public.training_certificate_templates AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (private.has_org_permission(organization_id,'training.manage'));
CREATE POLICY training_certificate_templates_insert_guard ON public.training_certificate_templates AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (private.has_org_permission(organization_id,'training.manage'));
CREATE POLICY training_certificate_templates_update ON public.training_certificate_templates AS PERMISSIVE FOR UPDATE TO authenticated USING (private.has_org_permission(organization_id,'training.manage')) WITH CHECK (private.has_org_permission(organization_id,'training.manage'));
CREATE POLICY training_certificate_templates_update_guard ON public.training_certificate_templates AS RESTRICTIVE FOR UPDATE TO authenticated USING (private.has_org_permission(organization_id,'training.manage')) WITH CHECK (private.has_org_permission(organization_id,'training.manage'));
CREATE POLICY training_certificate_templates_delete ON public.training_certificate_templates AS PERMISSIVE FOR DELETE TO authenticated USING (private.has_org_permission(organization_id,'training.manage'));
CREATE POLICY training_certificate_templates_delete_guard ON public.training_certificate_templates AS RESTRICTIVE FOR DELETE TO authenticated USING (private.has_org_permission(organization_id,'training.manage'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_certificate_templates TO authenticated;
CREATE OR REPLACE FUNCTION public.verify_training_certificate(p_token uuid)
RETURNS TABLE (
  valid boolean,
  participant_name text,
  event_title text,
  organization_name text,
  workload_hours numeric,
  issued_at date,
  expires_at date,
  certificate_number text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    (p.certificate_storage_path IS NOT NULL
      AND p.status = 'approved'
      AND (p.certificate_expires_at IS NULL OR p.certificate_expires_at >= current_date)) AS valid,
    coalesce(e.full_name, p.external_name) AS participant_name,
    ev.title AS event_title,
    coalesce(o.trade_name, o.legal_name, 'Organização emissora') AS organization_name,
    ev.workload_hours,
    p.certificate_issued_at,
    p.certificate_expires_at,
    p.certificate_number
  FROM public.training_participants p
  JOIN public.training_events ev ON ev.id=p.event_id AND ev.organization_id=p.organization_id
  JOIN public.organizations o ON o.id=p.organization_id
  LEFT JOIN public.employees e ON e.id=p.employee_id AND e.organization_id=p.organization_id
  WHERE p.certificate_verification_token=p_token
    AND p.certificate_storage_path IS NOT NULL
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.verify_training_certificate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_training_certificate(uuid) TO anon, authenticated;
