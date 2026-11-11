-- Classify DSR incidence by the remuneration nature of each payroll rubric.
alter table public.payroll_rubrics
  add column if not exists dsr_category text not null default 'other';

alter table public.payroll_variable_events
  add column if not exists dsr_category text not null default 'other';

update public.payroll_rubrics
set dsr_category = case
  when item_type = 'earning' and affects_dsr then 'other'
  else 'not_applicable'
end;

update public.payroll_variable_events
set dsr_category = case
  when item_type = 'earning' and affects_dsr then 'other'
  else 'not_applicable'
end;

alter table public.payroll_rubrics
  drop constraint if exists payroll_rubrics_dsr_category_check,
  add constraint payroll_rubrics_dsr_category_check
  check (
    (item_type = 'earning' and affects_dsr and dsr_category in
      ('overtime', 'commission', 'additional', 'bonus', 'other'))
    or
    ((item_type <> 'earning' or not affects_dsr) and dsr_category = 'not_applicable')
  );

alter table public.payroll_variable_events
  drop constraint if exists payroll_variable_events_dsr_category_check,
  add constraint payroll_variable_events_dsr_category_check
  check (
    (item_type = 'earning' and affects_dsr and dsr_category in
      ('overtime', 'commission', 'additional', 'bonus', 'other'))
    or
    ((item_type <> 'earning' or not affects_dsr) and dsr_category = 'not_applicable')
  );

comment on column public.payroll_rubrics.dsr_category is
  'Classification of DSR-incidence remuneration: overtime, commission, additional, bonus, other, or not_applicable.';
comment on column public.payroll_variable_events.dsr_category is
  'Snapshot of the DSR remuneration classification inherited from the source payroll rubric.';
