# Etapa 14 — compatibilidade do Supabase atual para rescisões

Data da revisão: 23/11/2026  
Projeto Supabase consultado: `fvpurcivbryteybiycub`  
Branch: `feat/dsr-normative-validation`

## Objetivo e limites

Preparar a implantação do módulo de rescisões no mesmo projeto Supabase já utilizado pelo sistema, conforme orientação do usuário. Esta etapa foi somente de leitura no banco: não aplicou DDL, não executou migrations, não inseriu fixtures e não alterou dados.

## Verificações no banco

Consulta read-only confirmou a existência dos objetos-base:

- `public.organizations`
- `public.employees`
- `public.organization_memberships`
- `public.payroll_parameter_tables`
- `public.employee_salary_history`
- `public.payroll_variable_events`
- `public.payroll_entries`
- `public.payroll_runs`

As colunas exigidas pelas migrations foram encontradas:

- `employees.id` e `employees.organization_id` (UUID)
- `organization_memberships.organization_id` e `user_id` (UUID)
- `organization_memberships.status` e `role` (TEXT)
- `payroll_parameter_tables.id` (UUID)

As tabelas `payroll_termination_cases` e `payroll_termination_calculation_items` ainda não existem. A listagem de migrations aplicada no banco termina em `20261119155650` (`validate_thirteenth_advance_amount_server_side`); as cinco migrations específicas de rescisões não constam como aplicadas.

## Ordem de implantação revisada

A sequência compatível com as dependências do código é:

1. `20261122120000_create_payroll_termination_cases.sql`
2. `20261122130000_create_payroll_termination_calculation_items.sql`
3. `20261122140000_link_reviewed_termination_averages.sql`
4. `20261123100000_fix_termination_audit_after_write.sql`
5. `20261123110000_add_termination_final_validation.sql`

A terceira migration depende das tabelas de processos/itens criadas nas duas primeiras. A quarta substitui os triggers iniciais de auditoria para gravar AFTER INSERT/UPDATE, evitando inserir auditoria antes de a linha principal existir. A quinta depende das tabelas e triggers anteriores para implementar revisão individual e validação final.

## Pontos de atenção identificados

- A migration inicial cria triggers de auditoria BEFORE; a correção da etapa 10 precisa ser aplicada na mesma sequência antes de qualquer uso operacional do módulo.
- A validação final só deve ser considerada disponível após a etapa 11 e a verificação da existência das duas RPCs.
- A migration de médias encaminhadas preserva o valor de origem, mas o item derivado continua `formula_pending`; não deve ser tratado como verba rescisória calculada.
- A checagem de compatibilidade confirma dependências estruturais, não comprova execução de DDL, RLS, RPC, concorrência, rollback ou comportamento com usuários autenticados.
- Não usar a presença do preview Vercel READY como evidência de que o banco foi atualizado.

## Resultado

**Compatibilidade estrutural preliminar: aprovada.** Os objetos e colunas-base verificados estão presentes e as migrations pendentes estão identificadas na ordem de dependência.

**Implantação e homologação dinâmica: pendentes.** Nenhuma migration foi aplicada nesta etapa. A aplicação das cinco migrations no projeto atual exige autorização explícita para alterar o schema do banco. Depois da autorização, executar uma migration por vez, verificar o resultado após cada aplicação e interromper imediatamente em caso de erro; somente então iniciar testes controlados de RLS/RPC sem usar dados pessoais reais.
