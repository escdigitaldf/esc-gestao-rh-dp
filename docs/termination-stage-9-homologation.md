# Etapa 9 — preparação da homologação das rescisões

## Objetivo e limites

Este roteiro prepara a homologação do encaminhamento transacional de médias remuneratórias para verbas preliminares de rescisão. Deve ser executado somente em projeto Supabase de desenvolvimento/homologação isolado, com credenciais e usuários sintéticos.

**Não executar no projeto ativo de produção.** Na verificação de 23/11/2026, o projeto `esc-gestao-rh-dp` era o único projeto Supabase ativo identificado para este sistema. Não foi identificado ambiente separado de homologação. Nenhuma fixture foi inserida e nenhuma migração foi aplicada nesta etapa.

## Pré-requisitos para iniciar os testes

- [ ] Criar ou indicar projeto Supabase isolado para homologação.
- [ ] Confirmar que o schema e as migrações-base correspondem ao branch testado.
- [ ] Aplicar primeiro, nesse ambiente isolado, as migrações de processos e itens de rescisão; depois a migração de vínculo/encaminhamento.
- [ ] Criar organização e processo de rescisão exclusivamente sintéticos.
- [ ] Criar dois usuários autenticados: operador autorizado e usuário autorizado revisor; criar também usuário sem membership/perfil permitido.
- [ ] Garantir que os usuários de teste não tenham acesso ao banco de produção.
- [ ] Registrar versão do commit, versão das migrações e resultado de cada cenário.

## Massa sintética mínima

| Registro | Conteúdo |
|---|---|
| Organização | UUID exclusivo de teste |
| Processo | Um processo não cancelado, associado à organização |
| Média de origem | `item_type=information`, código `MEDIA_*`, valor fixo de teste e status `pending_review` |
| Usuário A | Membership ativa com papel `payroll` ou `hr_manager` |
| Usuário B | Outra membership ativa autorizada na mesma organização |
| Usuário C | Sem membership ativa ou com papel não permitido |

Não usar CPF, dados pessoais, remunerações ou documentos de colaboradores reais.

## Casos de aceite — RPC transacional

| ID | Cenário | Resultado esperado |
|---|---|---|
| H01 | Usuário A encaminha média elegível, destino válido, fundamento e confirmação | Uma origem revisada e exatamente um derivado criado |
| H02 | `p_confirmed=false` ou nulo | Erro; nenhuma alteração |
| H03 | Usuário C tenta encaminhar | Negado; nenhuma alteração |
| H04 | Origem de outra organização/processo | Negado; nenhuma alteração |
| H05 | Origem bloqueada, rascunho ou de natureza diferente | Negado |
| H06 | Código de origem sem prefixo `MEDIA_` | Negado |
| H06a | Código semelhante, mas sem o sublinhado literal (`MEDIAx...`) | Negado; prefixo deve ser exatamente `MEDIA_` |
| H07 | Destino nulo ou fora da lista | Negado |
| H08 | Fundamento legal/coletivo vazio | Negado |
| H09 | Destino `other` sem descrição | Negado |
| H10 | Segunda chamada para a mesma origem | Negada; permanece um único derivado |
| H11 | Duas sessões encaminham a mesma origem simultaneamente | Uma operação vence; a outra falha; um derivado |
| H12 | Falha forçada no INSERT do derivado | Transação reverte também a atualização da origem |
| H13 | Usuário B autorizado revisa item criado por A | Permitido; `created_by` preservado e `updated_by` identifica B |
| H14 | Usuário fora da organização tenta revisar | Negado por RLS |
| H15 | Auditoria após sucesso | INSERT do derivado e UPDATE da origem identificam usuário e timestamp |

## Casos de aceite — integridade do vínculo

| ID | Tentativa | Resultado esperado |
|---|---|---|
| I01 | Derivado com valor diferente da origem | Rejeitado |
| I02 | Derivado como desconto, informativo ou encargo | Rejeitado |
| I03 | Derivado com método diferente de `formula_pending` | Rejeitado |
| I04 | Alterar a origem do derivado | Rejeitado |
| I05 | Alterar organização ou processo do derivado | Rejeitado |
| I06 | Alterar valor, método, snapshot de destino/origem ou fundamento do derivado | Revalidado e rejeitado se quebrar a correspondência |
| I07 | Alterar valor, natureza, status ou snapshot da origem após vínculo | Rejeitado pelo trigger de proteção da origem |
| I08 | Tentar criar segundo derivado para a mesma origem | Rejeitado pelo índice único |

A atualização do status do item derivado deverá continuar possível pelo fluxo posterior de revisão, desde que não modifique os dados de origem, valor, método, fundamento ou snapshot de integração. A validação não deve transformar o item em verba legalmente calculada.

## Evidências a guardar

Para cada cenário, registrar:
- ID do cenário e resultado (aprovado/reprovado);
- usuário e papel utilizado, sem armazenar tokens;
- código SQL/RPC executado e mensagem de retorno;
- contagem de itens antes/depois;
- estado e snapshot da origem e do derivado;
- registros de auditoria;
- confirmação de rollback quando aplicável.

## Critérios para liberar a próxima fase

- Todos os casos H01–H15 e I01–I08 aprovados no ambiente isolado.
- RLS, grants e políticas conferidos com usuários reais de teste.
- Concorrência executada em duas sessões independentes.
- Rollback demonstrado com falha provocada no INSERT.
- Build/preview do commit testado em estado READY.
- Revisão técnica da migração e aprovação explícita antes de qualquer aplicação no banco ativo.

## Estado em 23/11/2026

- Código e migração permanecem no branch `feat/dsr-normative-validation`.
- Proteção adicional de integridade do item derivado adicionada nesta etapa.
- Preview do commit `c535c6e5eb383b5f871124f558e86873e91a4c83` consultado como `READY`; a alteração desta etapa gera novo commit e requer novo preview.
- Projeto Supabase ativo do sistema identificado; ambiente isolado de homologação ainda não identificado.
- Nenhuma migração aplicada nesta etapa.
- Nenhuma fixture ou dado real inserido.
- PR #2 continua aberto em draft; não foi feito merge nem deploy de produção.


## Etapa 10 — auditoria após gravação

A migração `20261123100000_fix_termination_audit_after_write.sql` separa:
- preparação dos campos de atualização e verificação de imutabilidade em gatilhos `BEFORE`;
- gravação de `payroll_termination_case_audit` e `payroll_termination_calculation_item_audit` em gatilhos `AFTER`.

A separação é necessária porque as tabelas de auditoria possuem chaves estrangeiras para os registros principais. Inserir a auditoria no `BEFORE INSERT` pode falhar, pois a linha referenciada ainda não foi persistida.

### Casos adicionais de aceite

| ID | Cenário | Resultado esperado |
|---|---|---|
| A01 | Inserir processo de rescisão | Processo criado e registro INSERT de auditoria persistido |
| A02 | Atualizar processo | Registro UPDATE contém estado anterior e novo |
| A03 | Inserir item da memória | Item criado e auditoria INSERT vinculada à linha existente |
| A04 | Atualizar item da memória | Auditoria UPDATE vinculada, com old_record e new_record |
| A05 | Forçar falha ao inserir auditoria | Operação principal inteira deve sofrer rollback |
| A06 | Tentar alterar organização, colaborador/processo ou created_by | Operação rejeitada |
| A07 | Consultar auditoria como usuário autorizado | Leitura permitida pela RLS |
| A08 | Consultar auditoria como usuário não autorizado | Nenhuma linha visível |
| A09 | Usuário B, autorizado e diferente do criador, atualiza checklist/processo | Permitido; created_by permanece A e updated_by identifica B |

**Atenção:** esta correção foi criada como migração aditiva e ainda não foi aplicada. A execução dos casos A01–A08 depende de ambiente isolado de homologação. Não considerar a auditoria validada apenas pela existência dos triggers no código.


## Etapa 11 — revisão de rubricas e validação final

A migration `20261123110000_add_termination_final_validation.sql` implementa:
- status final `validated` no processo, separado de `ready_for_validation`;
- RPC `review_payroll_termination_calculation_item` para revisão individual por usuário autorizado, com confirmação e evidência obrigatória;
- para verbas financeiras, exige fundamento legal/coletivo; quando o item nasceu como `formula_pending`, o revisor precisa declarar que concluiu a conferência pelo método `manual` ou `parameter_table`;
- RPC `validate_payroll_termination_case` transacional, que exige processo em conferência, checklist não vazio e integralmente concluído, memória não vazia e todos os itens revisados;
- bloqueio de validação com item em `draft`, `pending_review`, `blocked`, verba financeira ainda `formula_pending` ou sem fundamento;
- snapshot da aprovação com responsável, data, justificativa, checklist e itens;
- bloqueio de alterações no processo e na memória após validação, inclusive por atualização direta via API;
- médias encaminhadas para verbas de destino permanecem bloqueadas para revisão final enquanto o destino não tiver recálculo próprio; o valor copiado da média não é aceito como verba calculada;
- auditoria AFTER permanece na mesma transação da operação.

### Casos de aceite adicionais

| ID | Cenário | Resultado esperado |
|---|---|---|
| V01 | Usuário autorizado revisa item com evidência e confirmação | Item passa a `reviewed`, com ator/timestamp na auditoria |
| V02 | Usuário sem papel permitido tenta revisar | Negado |
| V03 | Revisão sem evidência ou confirmação | Negada |
| V04 | Verba financeira sem fundamento legal/coletivo | Revisão negada |
| V05 | Verba financeira `formula_pending` sem método final explícito | Revisão negada |
| V06 | DP declara conclusão manual/tabela e registra evidência | Item revisado com método resolvido |
| V07 | Tentar validar com checklist vazio/incompleto | Negado |
| V08 | Tentar validar sem itens na memória | Negado |
| V09 | Tentar validar com item pendente, bloqueado ou rascunho | Negado |
| V10 | Tentar validar com fórmula financeira pendente ou fundamento ausente | Negado |
| V11 | Processo e itens integralmente revisados; usuário autorizado confirma e justifica | Processo passa a `validated` com snapshot |
| V12 | Tentar editar checklist/processo após validação | Negado |
| V13 | Tentar inserir/editar item após validação | Negado |
| V14 | Tentar definir `validated` diretamente por UPDATE/INSERT | Negado; somente RPC autorizada |
| V15 | Falha na auditoria durante a validação | Toda a transação deve sofrer rollback |

**Limite operacional:** migration criada no branch, não aplicada. Os cenários V01–V15 são critérios documentados, não testes executados. A revisão humana do valor não substitui conferência jurídica, convenção coletiva ou validação de documentos; a resolução de `formula_pending` significa que o DP assumiu a conclusão pelo método declarado, não que o sistema tenha comprovado a fórmula legal.

