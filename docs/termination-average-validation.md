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
