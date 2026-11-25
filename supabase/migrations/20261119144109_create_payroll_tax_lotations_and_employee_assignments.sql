create table if not exists public.organization_payroll_tax_lotations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 lotation_code text not null, establishment_cnpj text not null, preponderant_cnae text not null,
 simples_annex text, annex_iv_activity boolean, fpas_code text not null, third_party_code text not null,
 third_party_rate numeric(9,5) not null, rat_rate numeric(9,5) not null, fap_factor numeric(9,5) not null,
 fap_year integer not null, employer_inss_rate numeric(9,5) not null, employer_inss_substitution text not null,
 validity_from date not null, validity_to date,
 fpas_source_reference text not null, third_party_source_reference text not null, cnae_rat_source_reference text not null,
 fap_source_reference text not null, employer_inss_source_reference text not null, source_url text,
 status text not null default 'pending' check(status in ('pending','validated','inactive')), notes text,
 created_by uuid, validated_by uuid, validated_at timestamptz, validation_note text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,organization_id),
 check(lotation_code ~ '^[A-Za-z0-9._-]{1,30}$'), check(establishment_cnpj ~ '^[0-9]{14}$'),
 check(preponderant_cnae ~ '^[0-9]{7}$'), check(fpas_code ~ '^[0-9]{3}$'), check(third_party_code ~ '^[0-9]{4}$'),
 check(third_party_rate between 0 and 100), check(rat_rate between 0 and 100),
 check(fap_factor > 0 and fap_factor <= 10), check(fap_year between 2000 and 2100),
 check(employer_inss_rate between 0 and 100), check(validity_to is null or validity_to >= validity_from),
 check(employer_inss_substitution in ('none','partial','full','not_applicable','review_required')),
 check(simples_annex is null or simples_annex in ('I','II','III','IV','V','mixed'))
);
create index if not exists payroll_tax_lotations_org_validity_idx on public.organization_payroll_tax_lotations(organization_id,validity_from,validity_to);
create index if not exists payroll_tax_lotations_establishment_idx on public.organization_payroll_tax_lotations(organization_id,establishment_cnpj,lotation_code);
alter table public.employees add column if not exists default_payroll_lotation_id uuid;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.employees'::regclass and conname='employees_default_payroll_lotation_org_fk') then
  alter table public.employees add constraint employees_default_payroll_lotation_org_fk foreign key(default_payroll_lotation_id,organization_id) references public.organization_payroll_tax_lotations(id,organization_id) on delete restrict;
 end if;
end $$;
create table if not exists public.employee_payroll_lotation_assignments (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 employee_id uuid not null, payroll_lotation_id uuid not null, validity_from date not null, validity_to date,
 status text not null default 'pending' check(status in ('pending','validated','inactive')), source_reference text not null,
 notes text, created_by uuid, validated_by uuid, validated_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,organization_id),
 foreign key(employee_id,organization_id) references public.employees(id,organization_id) on delete restrict,
 foreign key(payroll_lotation_id,organization_id) references public.organization_payroll_tax_lotations(id,organization_id) on delete restrict,
 check(validity_to is null or validity_to >= validity_from)
);
create index if not exists employee_payroll_lotation_assignment_lookup_idx on public.employee_payroll_lotation_assignments(organization_id,employee_id,validity_from,validity_to);
create unique index if not exists employee_payroll_lotation_assignment_start_uq on public.employee_payroll_lotation_assignments(organization_id,employee_id,validity_from);
alter table public.organization_payroll_tax_lotations enable row level security;
alter table public.employee_payroll_lotation_assignments enable row level security;
drop policy if exists payroll_tax_lotations_select on public.organization_payroll_tax_lotations;
create policy payroll_tax_lotations_select on public.organization_payroll_tax_lotations for select to authenticated using(exists(select 1 from public.organization_memberships m where m.organization_id=organization_payroll_tax_lotations.organization_id and m.user_id=(select auth.uid()) and m.status='active'));
drop policy if exists payroll_tax_lotations_write on public.organization_payroll_tax_lotations;
create policy payroll_tax_lotations_write on public.organization_payroll_tax_lotations for all to authenticated using(exists(select 1 from public.organization_memberships m where m.organization_id=organization_payroll_tax_lotations.organization_id and m.user_id=(select auth.uid()) and m.status='active' and m.role in('owner','admin','hr_manager','payroll'))) with check(exists(select 1 from public.organization_memberships m where m.organization_id=organization_payroll_tax_lotations.organization_id and m.user_id=(select auth.uid()) and m.status='active' and m.role in('owner','admin','hr_manager','payroll')));
drop policy if exists employee_payroll_lotation_assignments_select on public.employee_payroll_lotation_assignments;
create policy employee_payroll_lotation_assignments_select on public.employee_payroll_lotation_assignments for select to authenticated using(exists(select 1 from public.organization_memberships m where m.organization_id=employee_payroll_lotation_assignments.organization_id and m.user_id=(select auth.uid()) and m.status='active'));
drop policy if exists employee_payroll_lotation_assignments_write on public.employee_payroll_lotation_assignments;
create policy employee_payroll_lotation_assignments_write on public.employee_payroll_lotation_assignments for all to authenticated using(exists(select 1 from public.organization_memberships m where m.organization_id=employee_payroll_lotation_assignments.organization_id and m.user_id=(select auth.uid()) and m.status='active' and m.role in('owner','admin','hr_manager','payroll'))) with check(exists(select 1 from public.organization_memberships m where m.organization_id=employee_payroll_lotation_assignments.organization_id and m.user_id=(select auth.uid()) and m.status='active' and m.role in('owner','admin','hr_manager','payroll')));
create or replace function public.validate_payroll_tax_lotation() returns trigger language plpgsql set search_path='' as $$
declare v_regime text;
begin
 new.updated_at:=now();
 if new.status='validated' then
  select o.tax_regime into v_regime from public.organizations o where o.id=new.organization_id;
  if v_regime is null or nullif(trim(v_regime),'') is null then raise exception 'Defina o regime tributário da organização antes de validar a lotação.'; end if;
  if new.fpas_source_reference !~ '[[:alnum:]]' or new.third_party_source_reference !~ '[[:alnum:]]' or new.cnae_rat_source_reference !~ '[[:alnum:]]' or new.fap_source_reference !~ '[[:alnum:]]' or new.employer_inss_source_reference !~ '[[:alnum:]]' then raise exception 'Cada classificação exige sua própria referência documental.'; end if;
  if v_regime='Simples Nacional' and (new.simples_annex is null or new.annex_iv_activity is null) then raise exception 'No Simples Nacional, informe o anexo e se a atividade desta lotação pertence ao Anexo IV.'; end if;
  if v_regime='Simples Nacional' and new.simples_annex='mixed' then raise exception 'A lotação deve representar um único anexo. Separe atividades em lotações distintas.'; end if;
  if v_regime='Simples Nacional' and (new.annex_iv_activity is distinct from (new.simples_annex='IV')) then raise exception 'A indicação de atividade do Anexo IV deve ser coerente com o anexo desta lotação.'; end if;
  if v_regime<>'Simples Nacional' and (new.simples_annex is not null or new.annex_iv_activity is not null) then raise exception 'Anexo do Simples não se aplica a este regime tributário.'; end if;
  if new.fap_year < extract(year from new.validity_from)::integer then raise exception 'O ano do FAP não pode ser anterior ao início da vigência.'; end if;
  new.validated_by:=coalesce(new.validated_by,(select auth.uid())); new.validated_at:=coalesce(new.validated_at,now());
 else new.validated_by:=null; new.validated_at:=null; end if;
 return new;
end $$;
create or replace function public.guard_validated_payroll_tax_lotation() returns trigger language plpgsql set search_path='' as $$
begin if old.status='validated' then raise exception 'Lotação tributária validada é imutável. Preserve o histórico e cadastre nova vigência.'; end if; if tg_op='DELETE' then return old; end if; return new; end $$;
drop trigger if exists validate_payroll_tax_lotation_trigger on public.organization_payroll_tax_lotations;
create trigger validate_payroll_tax_lotation_trigger before insert or update on public.organization_payroll_tax_lotations for each row execute function public.validate_payroll_tax_lotation();
drop trigger if exists guard_validated_payroll_tax_lotation_trigger on public.organization_payroll_tax_lotations;
create trigger guard_validated_payroll_tax_lotation_trigger before update or delete on public.organization_payroll_tax_lotations for each row execute function public.guard_validated_payroll_tax_lotation();
create or replace function public.validate_employee_payroll_lotation_assignment() returns trigger language plpgsql set search_path='' as $$
declare v_lotation public.organization_payroll_tax_lotations%rowtype;
begin
 new.updated_at:=now();
 perform 1 from public.employees e where e.id=new.employee_id and e.organization_id=new.organization_id for update;
 if not found then raise exception 'Colaborador não pertence à organização informada.'; end if;
 select * into v_lotation from public.organization_payroll_tax_lotations l where l.id=new.payroll_lotation_id and l.organization_id=new.organization_id;
 if not found then raise exception 'Lotação tributária não pertence à organização.'; end if;
 if new.status='validated' then
  if v_lotation.status<>'validated' then raise exception 'Somente lotação tributária validada pode ser atribuída.'; end if;
  if new.validity_from<v_lotation.validity_from or (v_lotation.validity_to is not null and (new.validity_to is null or new.validity_to>v_lotation.validity_to)) then raise exception 'A vigência da atribuição deve estar contida na vigência da lotação.'; end if;
  if exists(select 1 from public.employee_payroll_lotation_assignments a where a.organization_id=new.organization_id and a.employee_id=new.employee_id and a.id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid) and a.status='validated' and daterange(a.validity_from,coalesce(a.validity_to,'infinity'::date),'[]') && daterange(new.validity_from,coalesce(new.validity_to,'infinity'::date),'[]')) then raise exception 'Já existe atribuição validada com vigência sobreposta para este colaborador.'; end if;
  new.validated_by:=coalesce(new.validated_by,(select auth.uid())); new.validated_at:=coalesce(new.validated_at,now());
 else new.validated_by:=null; new.validated_at:=null; end if;
 return new;
end $$;
create or replace function public.guard_validated_employee_payroll_lotation_assignment() returns trigger language plpgsql set search_path='' as $$
begin if old.status='validated' then raise exception 'Atribuição tributária validada é imutável. Cadastre nova versão com vigência apropriada.'; end if; if tg_op='DELETE' then return old; end if; return new; end $$;
drop trigger if exists validate_employee_payroll_lotation_assignment_trigger on public.employee_payroll_lotation_assignments;
create trigger validate_employee_payroll_lotation_assignment_trigger before insert or update on public.employee_payroll_lotation_assignments for each row execute function public.validate_employee_payroll_lotation_assignment();
drop trigger if exists guard_validated_employee_payroll_lotation_assignment_trigger on public.employee_payroll_lotation_assignments;
create trigger guard_validated_employee_payroll_lotation_assignment_trigger before update or delete on public.employee_payroll_lotation_assignments for each row execute function public.guard_validated_employee_payroll_lotation_assignment();
create or replace view public.payroll_lotation_assignment_audit with(security_invoker=true) as
select r.organization_id,r.id payroll_run_id,r.reference_month competence,e.id payroll_entry_id,e.employee_id,e.employee_code,e.employee_name,
 count(a.id)::integer assignment_count,max(a.status) assignment_status,max(a.payroll_lotation_id::text)::uuid payroll_lotation_id,
 max(l.lotation_code) lotation_code,max(l.establishment_cnpj) establishment_cnpj,max(l.preponderant_cnae) preponderant_cnae,
 max(l.simples_annex) simples_annex,max(l.annex_iv_activity::integer)::boolean annex_iv_activity,
 max(l.fpas_code) fpas_code,max(l.third_party_code) third_party_code,max(l.third_party_rate) third_party_rate,
 max(l.rat_rate) rat_rate,max(l.fap_factor) fap_factor,max(l.fap_year) fap_year,max(l.employer_inss_rate) employer_inss_rate,
 case when count(a.id)=0 then 'missing_employee_lotation_assignment' when count(a.id)>1 then 'overlapping_employee_lotation_assignments'
 when max(a.status)<>'validated' then 'employee_lotation_assignment_pending'
 when bool_or(l.status<>'validated' or l.id is null) then 'lotation_not_validated' else 'validated_lotation_assignment' end audit_status
from public.payroll_runs r join public.payroll_entries e on e.payroll_run_id=r.id and e.organization_id=r.organization_id
left join public.employee_payroll_lotation_assignments a on a.organization_id=e.organization_id and a.employee_id=e.employee_id and a.validity_from<=r.reference_month and(a.validity_to is null or a.validity_to>=r.reference_month)
left join public.organization_payroll_tax_lotations l on l.id=a.payroll_lotation_id and l.organization_id=a.organization_id
group by r.organization_id,r.id,r.reference_month,e.id,e.employee_id,e.employee_code,e.employee_name;
grant select on public.payroll_lotation_assignment_audit to authenticated;
revoke execute on function public.validate_payroll_tax_lotation() from public,anon,authenticated;
revoke execute on function public.guard_validated_payroll_tax_lotation() from public,anon,authenticated;
revoke execute on function public.validate_employee_payroll_lotation_assignment() from public,anon,authenticated;
revoke execute on function public.guard_validated_employee_payroll_lotation_assignment() from public,anon,authenticated;
