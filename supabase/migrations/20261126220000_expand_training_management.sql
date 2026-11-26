-- Complete training, courses, lectures, enrollment, attendance and certificates.
CREATE TABLE IF NOT EXISTS public.training_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 180),
  description text,
  category text NOT NULL DEFAULT 'Geral',
  provider text,
  default_workload_hours numeric(7,2) NOT NULL DEFAULT 0 CHECK (default_workload_hours >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_courses_org_id_unique UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.training_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  course_id uuid,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 180),
  event_type text NOT NULL DEFAULT 'course' CHECK (event_type IN ('lecture','course','workshop','webinar','mandatory','other')),
  description text,
  provider text,
  instructor text,
  modality text NOT NULL DEFAULT 'in_person' CHECK (modality IN ('in_person','online','hybrid')),
  location text,
  meeting_url text,
  starts_at timestamptz,
  ends_at timestamptz,
  registration_deadline date,
  workload_hours numeric(7,2) NOT NULL DEFAULT 0 CHECK (workload_hours >= 0),
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  minimum_attendance_percent numeric(5,2) NOT NULL DEFAULT 75 CHECK (minimum_attendance_percent BETWEEN 0 AND 100),
  cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','open','in_progress','completed','cancelled')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_events_org_id_unique UNIQUE (id, organization_id),
  CONSTRAINT training_events_course_org_fk FOREIGN KEY (course_id, organization_id)
    REFERENCES public.training_courses(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT training_events_dates_check CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
);

CREATE TABLE IF NOT EXISTS public.training_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled','confirmed','attended','absent','approved','failed','cancelled')),
  attendance_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (attendance_percent BETWEEN 0 AND 100),
  score numeric(7,2) CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  certificate_number text,
  certificate_issued_at date,
  certificate_expires_at date,
  certificate_storage_path text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_participants_event_employee_unique UNIQUE (event_id, employee_id),
  CONSTRAINT training_participants_org_id_unique UNIQUE (id, organization_id),
  CONSTRAINT training_participants_event_org_fk FOREIGN KEY (event_id, organization_id)
    REFERENCES public.training_events(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT training_participants_employee_org_fk FOREIGN KEY (organization_id, employee_id)
    REFERENCES public.employees(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS training_events_org_starts_idx ON public.training_events(organization_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS training_events_org_status_idx ON public.training_events(organization_id, status);
CREATE INDEX IF NOT EXISTS training_participants_org_event_idx ON public.training_participants(organization_id, event_id);
CREATE INDEX IF NOT EXISTS training_participants_org_employee_idx ON public.training_participants(organization_id, employee_id);

CREATE OR REPLACE FUNCTION public.set_training_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS training_courses_updated_at ON public.training_courses;
CREATE TRIGGER training_courses_updated_at BEFORE UPDATE ON public.training_courses
FOR EACH ROW EXECUTE FUNCTION public.set_training_updated_at();
DROP TRIGGER IF EXISTS training_events_updated_at ON public.training_events;
CREATE TRIGGER training_events_updated_at BEFORE UPDATE ON public.training_events
FOR EACH ROW EXECUTE FUNCTION public.set_training_updated_at();
DROP TRIGGER IF EXISTS training_participants_updated_at ON public.training_participants;
CREATE TRIGGER training_participants_updated_at BEFORE UPDATE ON public.training_participants
FOR EACH ROW EXECUTE FUNCTION public.set_training_updated_at();

ALTER TABLE public.training_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS training_courses_read ON public.training_courses;
DROP POLICY IF EXISTS training_courses_read_guard ON public.training_courses;
DROP POLICY IF EXISTS training_courses_manage ON public.training_courses;
DROP POLICY IF EXISTS training_courses_manage_guard ON public.training_courses;
CREATE POLICY training_courses_read ON public.training_courses AS PERMISSIVE FOR SELECT TO authenticated
USING (private.has_org_permission(organization_id, 'training.view'));
CREATE POLICY training_courses_read_guard ON public.training_courses AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.has_org_permission(organization_id, 'training.view'));
CREATE POLICY training_courses_manage ON public.training_courses AS PERMISSIVE FOR ALL TO authenticated
USING (private.has_org_permission(organization_id, 'training.manage'))
WITH CHECK (private.has_org_permission(organization_id, 'training.manage'));
CREATE POLICY training_courses_manage_guard ON public.training_courses AS RESTRICTIVE FOR ALL TO authenticated
USING (private.has_org_permission(organization_id, 'training.manage'))
WITH CHECK (private.has_org_permission(organization_id, 'training.manage'));

DROP POLICY IF EXISTS training_events_read ON public.training_events;
DROP POLICY IF EXISTS training_events_read_guard ON public.training_events;
DROP POLICY IF EXISTS training_events_manage ON public.training_events;
DROP POLICY IF EXISTS training_events_manage_guard ON public.training_events;
CREATE POLICY training_events_read ON public.training_events AS PERMISSIVE FOR SELECT TO authenticated
USING (private.has_org_permission(organization_id, 'training.view'));
CREATE POLICY training_events_read_guard ON public.training_events AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.has_org_permission(organization_id, 'training.view'));
CREATE POLICY training_events_manage ON public.training_events AS PERMISSIVE FOR ALL TO authenticated
USING (private.has_org_permission(organization_id, 'training.manage'))
WITH CHECK (private.has_org_permission(organization_id, 'training.manage'));
CREATE POLICY training_events_manage_guard ON public.training_events AS RESTRICTIVE FOR ALL TO authenticated
USING (private.has_org_permission(organization_id, 'training.manage'))
WITH CHECK (private.has_org_permission(organization_id, 'training.manage'));

DROP POLICY IF EXISTS training_participants_read ON public.training_participants;
DROP POLICY IF EXISTS training_participants_read_guard ON public.training_participants;
DROP POLICY IF EXISTS training_participants_manage ON public.training_participants;
DROP POLICY IF EXISTS training_participants_manage_guard ON public.training_participants;
CREATE POLICY training_participants_read ON public.training_participants AS PERMISSIVE FOR SELECT TO authenticated
USING (private.has_org_permission(organization_id, 'training.view'));
CREATE POLICY training_participants_read_guard ON public.training_participants AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.has_org_permission(organization_id, 'training.view'));
CREATE POLICY training_participants_manage ON public.training_participants AS PERMISSIVE FOR ALL TO authenticated
USING (private.has_org_permission(organization_id, 'training.manage'))
WITH CHECK (private.has_org_permission(organization_id, 'training.manage'));
CREATE POLICY training_participants_manage_guard ON public.training_participants AS RESTRICTIVE FOR ALL TO authenticated
USING (private.has_org_permission(organization_id, 'training.manage'))
WITH CHECK (private.has_org_permission(organization_id, 'training.manage'));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('training-certificates','training-certificates',false,20971520,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET public=false, file_size_limit=20971520,
  allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS training_certificates_read ON storage.objects;
DROP POLICY IF EXISTS training_certificates_insert ON storage.objects;
DROP POLICY IF EXISTS training_certificates_update ON storage.objects;
DROP POLICY IF EXISTS training_certificates_delete ON storage.objects;
CREATE POLICY training_certificates_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id='training-certificates'
  AND EXISTS (
    SELECT 1 FROM public.training_participants p
    WHERE p.certificate_storage_path = name
      AND p.organization_id::text = split_part(name,'/',1)
      AND private.has_org_permission(p.organization_id,'training.view')
  )
);
CREATE POLICY training_certificates_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='training-certificates'
  AND EXISTS (
    SELECT 1 FROM public.training_participants p
    WHERE p.certificate_storage_path = name
      AND p.organization_id::text = split_part(name,'/',1)
      AND p.id::text = split_part(name,'/',2)
      AND private.has_org_permission(p.organization_id,'training.manage')
  )
);
CREATE POLICY training_certificates_update ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id='training-certificates'
  AND EXISTS (
    SELECT 1 FROM public.training_participants p
    WHERE p.certificate_storage_path = name
      AND p.organization_id::text = split_part(name,'/',1)
      AND p.id::text = split_part(name,'/',2)
      AND private.has_org_permission(p.organization_id,'training.manage')
  )
)
WITH CHECK (
  bucket_id='training-certificates'
  AND EXISTS (
    SELECT 1 FROM public.training_participants p
    WHERE p.certificate_storage_path = name
      AND p.organization_id::text = split_part(name,'/',1)
      AND p.id::text = split_part(name,'/',2)
      AND private.has_org_permission(p.organization_id,'training.manage')
  )
);
CREATE POLICY training_certificates_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id='training-certificates'
  AND EXISTS (
    SELECT 1 FROM public.training_participants p
    WHERE p.certificate_storage_path = name
      AND p.organization_id::text = split_part(name,'/',1)
      AND p.id::text = split_part(name,'/',2)
      AND private.has_org_permission(p.organization_id,'training.manage')
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_courses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_participants TO authenticated;
