-- Cover foreign keys added by the benefits and performance review modules.
create index if not exists benefit_types_created_by_idx on public.benefit_types(created_by);
create index if not exists benefit_types_employee_deduction_rubric_idx on public.benefit_types(employee_deduction_rubric_id,organization_id) where employee_deduction_rubric_id is not null;
create index if not exists benefit_types_employer_cost_rubric_idx on public.benefit_types(employer_cost_rubric_id,organization_id) where employer_cost_rubric_id is not null;
create index if not exists employee_benefit_assignments_created_by_idx on public.employee_benefit_assignments(created_by);
create index if not exists performance_review_cycles_created_by_idx on public.performance_review_cycles(created_by);
create index if not exists employee_performance_reviews_cycle_org_idx on public.employee_performance_reviews(cycle_id,organization_id);
create index if not exists employee_performance_reviews_employee_org_idx on public.employee_performance_reviews(employee_id,organization_id);
create index if not exists employee_performance_reviews_evaluator_idx on public.employee_performance_reviews(evaluator_user_id) where evaluator_user_id is not null;
