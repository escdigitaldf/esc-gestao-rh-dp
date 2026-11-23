# Matriz de validação — médias remuneratórias em rescisões

## Escopo

Esta matriz valida a integridade da amostra do motor assistido. Não define divisor ou período legal para todas as verbas. O fundamento aplicável deve ser identificado pelo DP na legislação vigente e na CCT/ACT da categoria.

## Regras implementadas

- Somente eventos com situação `processed` e conciliação `reconciled` são consultados.
- Rubricas inativas e rubricas que não sejam proventos são excluídas da seleção.
- Para médias de 13º e férias, a seleção é limitada às incidências cadastradas na rubrica.
- Divergência de incidência, divergência de DSR, diferença de composição superior a R$ 0,01 ou ausência de lançamento de folha excluem o evento da amostra.
- Identificadores repetidos de evento são contabilizados uma única vez.
- Rubricas com incidência relacionada ao DSR acionam conferência adicional para evitar dupla contagem.
- Resultado permanece informativo, `formula_pending` e `pending_review`.

## Casos sintéticos para homologação

| Caso | Entrada | Resultado esperado |
|---|---|---|
| Evento conciliado íntegro | Processado, reconciliado, sem divergências, com item de folha | Incluído uma vez |
| Evento pendente | `event_status = approved` | Excluído pela consulta |
| Evento rejeitado | `event_status = rejected` | Excluído pela consulta |
| Conciliação divergente | `reconciliation_status <> reconciled` | Excluído pela consulta |
| Divergência de incidência | `rubric_incidence_mismatch = true` | Excluído da amostra |
| Divergência de DSR | `item_dsr_mismatch = true` | Excluído da amostra |
| Diferença de composição | Diferença absoluta maior que R$ 0,01 | Excluído da amostra |
| Sem item de folha | `payroll_item_count = 0` | Excluído da amostra |
| Evento repetido | Mesmo `variable_event_id` retornado mais de uma vez | Contabilizado uma única vez |
| Mês sem ocorrência | Nenhum evento válido na competência | Mês permanece na grade; divisor-calendário não é reduzido |
| Divisor por ocorrência | Janela de 6 meses, eventos em 2 meses | Divisor apresentado como 2, com alerta de que só deve ser usado se a regra aplicável permitir |
| Divisor manual | DP informa divisor 5 | Média aritmética calculada com divisor 5, sujeita à confirmação |
| Rubrica relacionada ao DSR | Rubrica marcada com `affects_dsr` | Exige observação explícita sobre DSR antes de registrar |
| Nenhuma evidência válida | Todos os eventos excluídos ou sem ocorrências | Registro da média bloqueado |

## Limites conhecidos

- A marca `affects_dsr` identifica incidência da rubrica sobre o DSR; não prova que o DSR esteja incluído ou separado no valor do evento. A tela exige confirmação descritiva, mas a composição deve ser conferida nos lançamentos.
- O divisor por ocorrência é uma ferramenta de análise, não uma regra jurídica presumida.
- Não há massa real de folha, rubricas ou eventos no banco consultado. A homologação operacional depende de dados representativos, incluindo comissões, horas extras, adicionais e DSR.
- A atualização monetária, habitualidade, sazonalidade, afastamentos e critérios específicos de cada verba permanecem sob validação normativa e coletiva.

## Etapa 7 — encaminhamento controlado de médias

Os cenários abaixo devem ser executados em ambiente de homologação com dados sintéticos. A integração não transforma a média em verba definitiva.

| Cenário | Preparação | Resultado esperado |
|---|---|---|
| Média informativa pendente | Item `information`, código `MEDIA_*`, status `pending_review` | Só pode ser encaminhada após confirmação explícita do DP, destino e fundamento |
| Média informativa revisada | Item de origem com status `reviewed` e metadados de revisão | Elegível para encaminhamento, sem validação automática da verba derivada |
| Origem não revisada | Item `information` em `draft` ou `blocked` | Banco rejeita a criação do item derivado |
| Fundamento ausente | Tentar encaminhar sem base legal/coletiva | Interface bloqueia; banco também rejeita |
| Destino não informado | Tentar encaminhar sem natureza de destino | Interface bloqueia |
| Valor alterado | Inserir item derivado com valor diferente da origem | Trigger do banco rejeita |
| Destino sem natureza de provento | Inserir item derivado como desconto/informativo/encargo | Constraint/trigger rejeita |
| Duplicidade | Criar dois itens derivados para a mesma média | Índice único rejeita o segundo vínculo |
| Origem de outro processo | Usar média de outra organização ou processo | Trigger do banco rejeita |
| Média já encaminhada | Reabrir a mesma média após integração | Interface informa vínculo existente e não oferece nova aplicação |
| Item derivado | Conferir status e método após integração | Deve permanecer `earning`, `formula_pending`, `pending_review` |
| Valor de destino | Conferir os valores na memória | Valor é copiado sem recálculo; não atualiza automaticamente saldo, férias, 13º ou aviso |

**Limite funcional:** o encaminhamento cria um provento preliminar separado e rastreável. Não escolhe rubricas definitivas, não determina incidência tributária, não calcula reflexos e não atualiza os pré-cálculos de saldo salarial, férias ou 13º. O DP deve conferir o enquadramento, a composição da remuneração, o período, o divisor e a norma aplicável antes de qualquer validação posterior.

## Etapa 8 — homologação integrada e concorrência

A etapa 7 foi endurecida para executar o encaminhamento por RPC transacional. A operação atualiza a origem e insere o item derivado na mesma transação do PostgreSQL; falha em qualquer validação reverte as duas alterações.

| Cenário de aceite | Execução | Resultado esperado |
|---|---|---|
| Encaminhamento normal | Usuário autenticado autorizado, média `MEDIA_*` pendente, destino e fundamento preenchidos e checkbox marcado | RPC retorna ID do novo item; origem revisada e derivado criado como `earning / formula_pending / pending_review` |
| Confirmação ausente | Chamar RPC com `p_confirmed=false` ou nulo | Exceção; nenhuma alteração na origem nem item derivado |
| Usuário sem perfil autorizado | Chamar RPC sem membership ativa em papel permitido | Exceção; nenhuma gravação |
| Origem de outro processo/organização | Informar ID de média fora do processo/organização | Origem não encontrada pela consulta escopada; exceção |
| Código/natureza inválidos | Origem que não seja `information` ou não tenha prefixo `MEDIA_*` | Exceção |
| Destino nulo ou fora da lista | Informar destino inválido | Exceção |
| Fundamento ausente | Fundamento vazio ou nulo | Exceção |
| Outra verba sem descrição | Destino `other` e rótulo vazio | Exceção |
| Requisições concorrentes | Disparar dois encaminhamentos simultâneos para a mesma origem | Bloqueio de linha serializa as operações; apenas uma cria derivado, a segunda recebe exceção |
| Falha na inserção do derivado | Forçar violação de constraint no insert em ambiente de teste | Transação reverte a atualização de status/snapshot da origem |
| Alteração posterior da origem | Tentar alterar valor, natureza, status ou snapshot após existir derivado | Trigger bloqueia a alteração; retificação deve seguir fluxo auditável próprio |
| Auditoria | Conferir registros de auditoria após sucesso | Atualização da origem e inserção do derivado aparecem com usuário e timestamp |
| RLS de revisão | Usuário autorizado diferente do criador revisa a média | Permitido dentro da organização; autoria original permanece imutável |
| Usuário fora da organização | Tentar revisão/encaminhamento sem membership ativa | Negado por RLS/RPC |

### Verificações ainda necessárias antes da liberação operacional

1. Aplicar a migração somente em ambiente de homologação autorizado.
2. Criar dados sintéticos isolados (organização, processo, média informativa) e executar os cenários acima.
3. Confirmar que o usuário revisor pode atualizar item criado por outro usuário, sem alterar `created_by`.
4. Confirmar rollback transacional e concorrência com duas sessões independentes.
5. Inspecionar auditoria e grants efetivos da RPC.
6. Repetir build/preview após a integração RPC.
7. Só então solicitar aprovação para aplicar a migração no ambiente de produção.

**Limite atual:** nenhum desses testes altera dados reais; a migração permanece pendente. Build READY confirma compilação e geração de páginas, não a execução do RPC nem o comportamento de RLS no banco. O banco consultado não contém massa real de folha/rescisão para homologação ponta a ponta.
