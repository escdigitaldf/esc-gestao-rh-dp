# Etapa 18 — plano de testes de integridade e concorrência

## Objetivo e limites

Definir uma suíte repetível para homologar o fluxo de verbas rescisórias derivadas de médias, recálculo, revisão individual, validação final, autorização por organização e auditoria transacional.

Este documento é um plano de testes. **Não representa execução dos testes nem aplicação de migrations.** Os testes com escrita devem rodar somente em banco local/efêmero isolado, com migrations aplicadas nesse ambiente e fixtures descartáveis. Não executar os cenários de escrita no projeto Supabase ativo.

## Estado do repositório

- O `package.json` não configura Vitest, Jest, pgTAP ou outro runner; scripts existentes: `dev`, `build`, `start`, `lint`.
- Não adicionar dependência ou script de teste até escolher e padronizar o ambiente de homologação.
- A suíte SQL abaixo deve ser implementada preferencialmente com pgTAP no Supabase local, ou em um PostgreSQL efêmero equivalente que reproduza as extensões, roles e contexto de autenticação do Supabase.
- Aplicar migrations em ordem cronológica no ambiente isolado antes de executar os casos.

## Pré-condições da suíte

1. Banco local/efêmero descartável, sem conexão com produção ou staging ativo.
2. Migrations de rescisão aplicadas na ordem do diretório `supabase/migrations`.
3. Fixtures isoladas para duas organizações (A e B), dois usuários autorizados na organização A, um usuário sem vínculo e uma tabela de parâmetros pertencente à organização B.
4. Processo de rescisão em estado elegível, checklist completo e memória com ao menos:
   - uma média informativa elegível, revisada e encaminhada;
   - o item derivado criado por `route_payroll_termination_average`;
   - outro item financeiro independente para testar revisão e validação.
5. Usar claims/JWT e role `authenticated` realistas. Não simular autorização apenas por alterar o resultado esperado no teste.
6. Cada caso deve iniciar com fixtures limpas ou executar rollback integral.

## Matriz de cenários

| ID | Cenário | Resultado esperado |
|---|---|---|
| S18-01 | Criar/encaminhar média elegível | A origem é revisada; o item derivado nasce como `earning / pending_review / formula_pending`, preservando o valor de origem e o vínculo |
| S18-02 | Concluir recálculo manual válido | RPC retorna `calculation_completed_pending_review`; valor/método/evidência ficam no snapshot; item continua `pending_review` |
| S18-03 | Concluir por tabela da mesma organização | Operação aceita tabela pertencente à organização do processo e registra seu UUID no item/snapshot |
| S18-04 | Concluir por tabela de outra organização | RPC rejeita; nenhum campo do item é alterado |
| S18-05 | Usuário sem membership ativa | RPC rejeita; nenhum campo do item é alterado |
| S18-06 | Membership com papel não autorizado | RPC rejeita; nenhum campo do item é alterado |
| S18-07 | Evidência ou fundamento ausente | RPC rejeita cada variação; nenhum campo do item é alterado |
| S18-08 | Valor final negativo ou nulo | RPC rejeita; nenhum campo do item é alterado |
| S18-09 | Método/tabela incompatíveis | Manual com UUID de tabela e parameter_table sem UUID são rejeitados |
| S18-10 | Chamada sem confirmação explícita | RPC rejeita quando `p_confirmed` não é true |
| S18-11 | UPDATE direto tentando concluir derivado | Trigger rejeita estado concluído sem autorização transacional e snapshot coerente |
| S18-12 | Recálculo concluído seguido de revisão individual | RPC de revisão aceita método já concluído; item passa a `reviewed` e conserva o snapshot do recálculo |
| S18-13 | Revisão de derivado ainda `formula_pending` | Revisão deve ser rejeitada: não se pode revisar fórmula financeira não concluída |
| S18-14 | Validação final com derivado ainda pendente | Validação rejeita e não congela o processo |
| S18-15 | Validação final após todos os itens revisados | Processo passa a `validated`; snapshot final registra itens, valores, métodos e justificativa |
| S18-16 | Alteração de item após validação | Trigger rejeita inclusão/alteração; processo permanece congelado |
| S18-17 | Recálculo concorrente com validação final | Bloqueio da linha do processo serializa as operações: ou o recálculo termina primeiro e a validação ainda exige revisão, ou a validação termina primeiro e o recálculo é rejeitado |
| S18-18 | Auditoria AFTER em transação confirmada | Existe registro de auditoria correspondente à alteração, com ator e valores anterior/novo conforme contrato da auditoria |
| S18-19 | Falha após disparo da auditoria e rollback | Alteração e registro de auditoria são revertidos juntos; não sobra auditoria órfã |
| S18-20 | Isolamento entre organizações | Usuário da organização A não lê nem altera processo/item/tabela da organização B, inclusive por RPC |

## Assertions mínimas

### Integridade do recálculo

- O `source_calculation_item_id` permanece imutável.
- A origem informativa não muda após encaminhamento.
- O valor de origem registrado no snapshot é igual ao valor da média encaminhada.
- O valor final do snapshot é igual ao `amount` persistido.
- O método no snapshot é igual ao `calculation_method` persistido.
- Método `manual` implica `source_parameter_table_id IS NULL`.
- Método `parameter_table` implica tabela existente e da mesma organização.
- O recálculo não muda o status para `reviewed`.

### Revisão e validação

- A revisão exige usuário autenticado, membership ativa autorizada, confirmação e observação.
- Item financeiro exige fundamento legal/coletivo.
- Item com `formula_pending` não pode ser revisado.
- Validação final exige checklist não vazio e integralmente concluído, memória não vazia e todos os itens revisados.
- Depois da validação, alterações no processo e nos itens são bloqueadas.

### Concorrência

Executar S18-17 com duas sessões PostgreSQL independentes, usando barreiras explícitas no teste (não temporizadores frágeis):

1. Sessão A inicia a RPC de recálculo e obtém o lock `FOR UPDATE` do processo.
2. Sessão B inicia a RPC de validação final e deve aguardar o lock da sessão A.
3. Sessão A conclui e confirma a transação.
4. Sessão B prossegue; como o item derivado ainda está pendente de revisão, a validação deve falhar.
5. Repetir invertendo a ordem: a validação final conclui primeiro; o recálculo, ao obter o lock, deve rejeitar o processo validado.

O teste deve verificar estado final e ausência de atualizações parciais nas duas ordens.

## Auditoria transacional

O teste de rollback deve ser feito em banco isolado com uma falha controlada após o UPDATE que aciona o trigger de auditoria, mas antes do COMMIT. Verificar que tanto a alteração principal quanto a linha de auditoria foram revertidas. Não criar trigger de falha permanente em ambientes compartilhados.

## Esqueleto de implementação pgTAP

A implementação deverá usar `plan()`, `has_function()`, `throws_ok()`, `lives_ok()`, `is()`, `isnt()` e consultas de estado conforme a versão de pgTAP disponível no ambiente local. Exemplo conceitual (adaptar aos nomes e colunas exatos das fixtures após aplicar as migrations no ambiente local):

```sql
begin;
select plan(4);

-- Preparar fixtures isoladas e autenticação de usuário autorizado.
-- Invocar a RPC com método manual e dados completos.
-- Verificar status pending_review e método manual.
-- Tentar método parameter_table com tabela de outra organização.
-- Verificar rejeição e ausência de alteração.
-- Tentar validação final com item pendente e verificar rejeição.

select * from finish();
rollback;
```

O exemplo é deliberadamente um esqueleto: não deve ser executado sem fixtures reais, migrations aplicadas e claims de autenticação configurados.

## Correção implementada durante a Etapa 18

A revisão do fluxo revelou que a migration da Etapa 17 aceitava o item derivado no estado inicial e após recálculo, mas não aceitava a transição para `reviewed` executada pela RPC `review_payroll_termination_calculation_item`. Como essa RPC atualiza `calculation_method`, o trigger `UPDATE OF calculation_method` era disparado e rejeitava a transição. Foi criada a migration `20261123130000_allow_review_of_completed_derived_termination_items.sql` para corrigir esse contrato. A correção está apenas no branch; ainda não foi aplicada nem executada em banco.

## Critérios de aceite da Etapa 18

- [ ] Revisão de compatibilidade das migrations 3, 5 e 17 concluída em ambiente isolado.
- [ ] Suíte pgTAP implementada e executada em banco local/efêmero.
- [ ] S18-01 a S18-20 aprovados ou com defeitos registrados e corrigidos.
- [ ] Concorrência testada com duas sessões independentes.
- [ ] Auditoria AFTER e rollback confirmados.
- [ ] Build e lint executados localmente ou via CI, com resultados registrados.
- [ ] Nenhuma migration aplicada ao Supabase ativo.
- [ ] Nenhuma fixture gravada em banco ativo.
- [ ] PR revisado; não fazer merge nem deploy de produção sem autorização.

## Observações técnicas para revisão

- A migration da Etapa 17 substitui a função de trigger `validate_payroll_termination_item_source()` e preserva o estado inicial e o estado concluído de um item derivado.
- A migration `20261123130000_allow_review_of_completed_derived_termination_items.sql` (correção identificada nesta etapa) também atualiza o trigger para permitir que a RPC de revisão individual promova um recálculo concluído de `pending_review` para `reviewed`, exigindo o GUC transacional de revisão, snapshot íntegro, método e tabela coerentes. A promoção direta sem a RPC deve continuar sendo rejeitada.
- A RPC de recálculo bloqueia primeiro a linha do processo com `FOR UPDATE`, alinhando sua ordem de lock com a validação final.
- A validação final também bloqueia o processo antes de verificar checklist e itens. A revisão individual, por sua vez, bloqueia o item; a suíte deve verificar se a política de locks e os triggers não produzem deadlock em operações simultâneas.
- A migration 17 usa `v_completed` apenas como atribuição sem leitura posterior; é código morto, sem efeito funcional aparente, e pode ser removido em uma revisão de limpeza.
- O teste de auditoria precisa confirmar o contrato concreto do trigger AFTER e da tabela de auditoria definida nas migrations anteriores; não presumir nomes de colunas sem conferir o schema completo.
- Vigência de tabela de parâmetros por competência e adequação jurídica do cálculo permanecem validações de negócio/DP; a RPC atual confirma pertencimento à organização, não substitui a análise de vigência e aplicabilidade normativa.
