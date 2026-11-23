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
