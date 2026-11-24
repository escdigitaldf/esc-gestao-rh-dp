# Etapa 15 — preflight de implantação do módulo de rescisões

**Escopo:** revisão estática das cinco migrations de rescisões, preparação de verificações read-only e plano de homologação/rollback.  
**Banco:** projeto Supabase atual `fvpurcivbryteybiycub`.  
**Situação desta etapa:** documentação no branch; nenhuma migration aplicada, nenhuma DDL executada e nenhum dado inserido/alterado.

## 1. Ordem obrigatória e dependências

| Ordem | Migration | Dependência / efeito |
|---|---|---|
| 1 | `20261122120000_create_payroll_termination_cases.sql` | Cria processos rescisórios, auditoria, índices, RLS e trigger inicial |
| 2 | `20261122130000_create_payroll_termination_calculation_items.sql` | Depende da tabela de processos; cria itens da memória, auditoria, RLS e trigger inicial |
| 3 | `20261122140000_link_reviewed_termination_averages.sql` | Depende dos itens; cria vínculo de origem, unicidade, trigger de integridade e RPC de encaminhamento |
| 4 | `20261123100000_fix_termination_audit_after_write.sql` | Substitui auditoria BEFORE por preparação BEFORE + registro AFTER; ajusta policy de revisão |
| 5 | `20261123110000_add_termination_final_validation.sql` | Acrescenta estado validado, bloqueios de imutabilidade e RPCs de revisão/validação final |

Não inverter a ordem. A migração 4 é necessária para corrigir o mecanismo inicial de auditoria criado nas migrations 1 e 2. A migração 5 pressupõe as tabelas e os mecanismos anteriores.

## 2. Revisão estática por migration

### 2.1 Processos rescisórios
- FK para organização e colaborador; colaborador não pode ser removido enquanto houver processo.
- Índice parcial impede mais de um processo não cancelado por colaborador/organização.
- RLS restringe leitura/escrita a membership ativa com perfil owner, admin, hr_manager ou payroll.
- Não concede DELETE; auditoria é somente leitura para authenticated.
- Trigger inicial registra INSERT/UPDATE. A migration 4 substitui esse registro BEFORE por AFTER para respeitar a FK do registro principal.
- Atenção: a unicidade parcial considera todos os estados diferentes de cancelled, inclusive validated. A regra de negócio de reabertura/retificação deve continuar sendo tratada por novo fluxo auditável, não por exclusão.

### 2.2 Itens da memória
- FK para processo e tabela de parâmetros; valor não negativo; natureza, método e status limitados por CHECK.
- RLS exige membership ativa e processo da mesma organização.
- Sem DELETE; trilha de auditoria separada.
- Trigger inicial de auditoria também é substituído pela migration 4.
- A política de atualização deve permitir revisão por outro usuário autorizado sem permitir troca da autoria original; confirmar em teste dinâmico com dois usuários da mesma organização.

### 2.3 Encaminhamento de médias
- Cria vínculo único entre média de origem e item derivado.
- Exige mesma organização/processo, origem informativa revisada, código MEDIA_ literal, destino/fundamento registrados e preservação do valor.
- RPC transacional bloqueia a linha de origem e impede encaminhamento duplicado concorrente.
- Item derivado nasce como earning / formula_pending / pending_review; isso não equivale a verba rescisória calculada.
- A origem vinculada fica protegida contra alterações posteriores.
- Testar concorrência, repetição da chamada, origem de outra organização/processo e alteração posterior da origem.

### 2.4 Auditoria AFTER
- Separa validação/preparação BEFORE do registro AFTER para processos e itens.
- A auditoria permanece na mesma transação da gravação principal; falha no registro de auditoria deve reverter a operação.
- Revisa policy UPDATE do processo para permitir revisor autorizado diferente do criador, mantendo autoria imutável.
- Testar INSERT, UPDATE, rollback, ator, old_record/new_record e RLS de leitura da auditoria.

### 2.5 Revisão e validação final
- Adiciona estado validated e restringe sua transição às RPCs autorizadas.
- Revisão individual exige membership ativa, confirmação, evidência e fundamento legal/coletivo para verba financeira.
- Revisão por tabela de parâmetros exige referência à tabela vinculada; fórmula pendente deve ser concluída manualmente ou por tabela.
- Validação final exige processo em conferência, checklist completo, memória não vazia, todos os itens revisados e nenhuma fórmula financeira pendente/fundamento ausente.
- Snapshot de validação registra usuário, data, justificativa, checklist e itens.
- Após validado, processo e itens ficam bloqueados para alteração.
- Testar chamadas diretas de UPDATE/INSERT, RPC por perfil sem permissão, checklist vazio/incompleto, item pendente/bloqueado e tentativa de revalidação.

## 3. Preflight SQL — somente leitura

Executar apenas SELECTs abaixo antes de qualquer implantação. Não executar INSERT, UPDATE, DELETE, TRUNCATE, DDL ou chamadas às RPCs.

### 3.1 Confirmar tabelas-base e tabelas rescisórias
```sql
select
  to_regclass('public.organizations') as organizations,
  to_regclass('public.employees') as employees,
  to_regclass('public.organization_memberships') as organization_memberships,
  to_regclass('public.payroll_parameter_tables') as payroll_parameter_tables,
  to_regclass('public.payroll_termination_cases') as termination_cases,
  to_regclass('public.payroll_termination_case_audit') as termination_case_audit,
  to_regclass('public.payroll_termination_calculation_items') as termination_items,
  to_regclass('public.payroll_termination_calculation_item_audit') as termination_item_audit;
```

### 3.2 Confirmar RPCs
```sql
select
  to_regprocedure('public.route_payroll_termination_average(uuid,uuid,uuid,text,text,text,boolean)') as route_average,
  to_regprocedure('public.review_payroll_termination_calculation_item(uuid,uuid,uuid,text,text,boolean)') as review_item,
  to_regprocedure('public.validate_payroll_termination_case(uuid,uuid,text,boolean)') as validate_case;
```

### 3.3 Conferir políticas e RLS após implantação
```sql
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename like 'payroll_termination%'
order by tablename, policyname;
```

```sql
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname like 'payroll_termination%'
order by c.relname;
```

### 3.4 Conferir triggers
```sql
select event_object_table, trigger_name, action_timing, event_manipulation,
       action_statement
from information_schema.triggers
where trigger_schema = 'public'
  and event_object_table like 'payroll_termination%'
order by event_object_table, trigger_name, event_manipulation;
```

Critérios esperados após as cinco migrations:
- quatro tabelas rescisórias presentes;
- três RPCs presentes;
- RLS habilitado nas quatro tabelas;
- triggers de preparação BEFORE e registro AFTER nas tabelas principais/itens;
- trigger de validação final e trigger de integridade do vínculo presentes;
- policies limitadas a usuários autenticados e membership ativa, sem política de DELETE.

## 4. Homologação dinâmica — não executar no banco ativo nesta etapa

Executar somente após aprovação de implantação, em janela controlada e com massa sintética aprovada, preferencialmente em projeto isolado. Não usar dados pessoais reais para fixtures.

| Grupo | Teste | Resultado esperado |
|---|---|---|
| DDL | Aplicar migrations na ordem 1–5 | Todas concluem sem erro |
| Isolamento | Usuário sem membership / membership inativa | Sem leitura ou escrita |
| Perfis | owner/admin/hr_manager/payroll e perfil não autorizado | Ações conforme matriz de permissão |
| Organização | Tentar relacionar colaborador/processo de outra organização | Negado |
| Auditoria | Criar e atualizar processo/item | Auditoria AFTER com ator e snapshots corretos |
| Atomicidade | Forçar falha durante auditoria/RPC | Operação inteira revertida |
| Média | Encaminhar média elegível | Um item derivado pendente, origem preservada |
| Duplicidade | Repetir e concorrer com encaminhamentos | Apenas um vínculo |
| Revisão | Revisar item com/sem evidência e fundamento | Só revisão completa autorizada |
| Parâmetros | Declarar método tabela sem fonte | Bloqueado |
| Validação | Checklist incompleto ou item pendente | Validação recusada |
| Imutabilidade | Alterar processo/item após validado | Bloqueado |
| Auditoria RLS | Usuário externo tenta ler auditoria | Negado |

Cada teste deve guardar: usuário/perfil, organização de teste, comando executado, resultado esperado/obtido e timestamp. Limpar fixtures apenas no ambiente isolado e após preservar evidências.

## 5. Plano de implantação e rollback

1. Confirmar backup/PITR disponível e janela de manutenção aprovada.
2. Capturar estado inicial das migrations aplicadas, tabelas, funções, policies, triggers e grants.
3. Conferir novamente o HEAD e o CI do PR; preview deve estar READY para o commit correspondente.
4. Aplicar as cinco migrations na ordem registrada, sem misturar alterações de outros módulos.
5. Após cada migration, verificar retorno e estado do catálogo; interromper imediatamente em qualquer divergência.
6. Executar os SELECTs da seção 3 e a homologação da seção 4 antes de liberar a interface.
7. Se houver falha, não improvisar DROP/DELETE nem editar manualmente o histórico de migrations. Interromper a liberação, preservar logs e evidências e preparar migration corretiva *forward-only*. Restauração de backup/PITR somente com avaliação do impacto sobre dados posteriores e aprovação expressa.
8. Não realizar merge do PR nem deploy de produção como parte deste preflight.

## 6. Riscos e pendências que permanecem abertas

- Compatibilidade estrutural das tabelas-base foi conferida anteriormente, mas não substitui execução real das migrations.
- RLS, grants, SECURITY DEFINER, concorrência e rollback ainda não foram testados dinamicamente.
- O ambiente atual não possui as tabelas rescisórias; as migrations continuam pendentes.
- A validação final do processo não substitui conferência jurídica, sindical/coletiva, cálculo oficial, TRCT ou eventos de desligamento do eSocial.
- Itens derivados de médias continuam pendentes até que a verba de destino seja efetivamente recalculada e revisada.
- A migration 1/2 contém triggers de auditoria iniciais; a migration 4 deve ser aplicada antes de qualquer operação funcional com dados.
- O estado do preview deve ser consultado novamente no commit atualizado; build anterior READY não comprova o novo HEAD.

## 7. Decisão de liberação

**Preflight documental concluído. Implantação bloqueada por decisão de controle:** as migrations não foram aplicadas, pois esta etapa não contém autorização explícita para alterar o schema do Supabase ativo. O próximo marco é a autorização expressa para aplicar as cinco migrations, seguida da verificação pós-implantação e homologação controlada.
