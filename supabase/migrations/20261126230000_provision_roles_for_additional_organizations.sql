create or replace function private.create_organization(
  p_legal_name text,
  p_trade_name text default null,
  p_cnpj text default null,
  p_email text default null,
  p_phone text default null,
  p_city text default null,
  p_state text default null,
  p_tax_regime text default null,
  p_full_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_template_org_id uuid;
  v_admin_role_id uuid;
  v_cnpj text;
begin
  if v_user_id is null then
    raise exception 'Autenticação necessária.' using errcode = '28000';
  end if;

  if nullif(trim(p_legal_name), '') is null then
    raise exception 'A razão social é obrigatória.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.organization_memberships m
    where m.user_id = v_user_id and m.status = 'active'
  ) and not exists (
    select 1
    from public.organization_memberships m
    where m.user_id = v_user_id
      and m.status = 'active'
      and private.is_org_admin(m.organization_id)
  ) then
    raise exception 'Somente administradores podem cadastrar outra empresa.' using errcode = '42501';
  end if;

  select r.organization_id
    into v_template_org_id
  from public.organization_roles r
  order by r.created_at asc
  limit 1;

  if v_template_org_id is null then
    raise exception 'Modelos de perfis não encontrados. Procure o suporte.' using errcode = '55000';
  end if;

  v_cnpj := nullif(regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g'), '');

  if v_cnpj is not null and length(v_cnpj) <> 14 then
    raise exception 'CNPJ deve conter 14 dígitos.' using errcode = '22023';
  end if;

  insert into public.organizations (
    legal_name, trade_name, cnpj, email, phone, city, state, tax_regime,
    status, employee_limit, trial_ends_at
  ) values (
    trim(p_legal_name), nullif(trim(p_trade_name), ''), v_cnpj,
    nullif(trim(p_email), ''), nullif(trim(p_phone), ''),
    nullif(trim(p_city), ''), upper(nullif(trim(p_state), '')),
    nullif(trim(p_tax_regime), ''), 'trial', 350, now() + interval '14 days'
  )
  returning id into v_org_id;

  insert into public.organization_roles (
    organization_id, role_key, name, description, is_system
  )
  select
    v_org_id, source.role_key, source.name, source.description, source.is_system
  from (
    select distinct on (role_key) role_key, name, description, is_system
    from public.organization_roles
    where organization_id = v_template_org_id
    order by role_key, created_at
  ) source;

  insert into public.organization_role_permissions (role_id, permission_key, allowed)
  select new_role.id, source_permission.permission_key, source_permission.allowed
  from public.organization_roles new_role
  join public.organization_roles source_role
    on source_role.organization_id = v_template_org_id
   and source_role.role_key = new_role.role_key
  join public.organization_role_permissions source_permission
    on source_permission.role_id = source_role.id
  where new_role.organization_id = v_org_id;

  select id into v_admin_role_id
  from public.organization_roles
  where organization_id = v_org_id and role_key = 'admin'
  limit 1;

  if v_admin_role_id is null then
    raise exception 'Não foi possível preparar o perfil administrador.' using errcode = '55000';
  end if;

  insert into public.organization_memberships (organization_id, user_id, role, role_id, status)
  values (v_org_id, v_user_id, 'owner', v_admin_role_id, 'active');

  insert into public.user_profiles (id, full_name)
  values (v_user_id, nullif(trim(p_full_name), ''))
  on conflict (id) do update
    set full_name = coalesce(public.user_profiles.full_name, excluded.full_name),
        updated_at = now();

  insert into public.audit_logs (
    organization_id, actor_user_id, action, resource_type, resource_id, metadata
  ) values (
    v_org_id, v_user_id, 'organization.created', 'organization', v_org_id::text,
    jsonb_build_object('source', 'company_management')
  );

  return v_org_id;
end;
$function$;
