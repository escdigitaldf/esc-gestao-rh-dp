# Etapa 16 — revisão de consistência das RPCs e regras de integridade

**Escopo:** revisão estática cruzada das migrations de vínculo de médias e validação final.  
**Resultado:** identificado bloqueio funcional no fluxo de revisão de itens derivados.  
**Banco Supabase:** nenhuma alteração; análise realizada sobre o código do branch.

## 1. Achado crítico — conflito entre trigger de origem e RPC de revisão

### Evidência no código

A migration `20261122140000_link_reviewed_termination_averages.sql` cria o trigger `validate_payroll_termination_item_source_trigger`, disparado em INSERT e em UPDATE de campos que incluem `calculation_method`, `calculation_status`, `amount`, `calculation_snapshot` e `legal_basis`.

Para qualquer item que tenha `source_calculation_item_id`, a função atualmente exige, entre outras condições:
- `item_type = 'earning'`;
- `calculation_status = 'pending_review'`;
- `calculation_method = 'formula_pending'`;
- `amount = amount` da média de origem;
- fundamento não vazio.

A migration `20261123110000_add_termination_final_validation.sql` cria a RPC `review_payroll_termination_calculation_item`. Quando revisa um item financeiro com método `formula_pending`, a RPC altera:
- `calculation_status` para `reviewed`;
- `calculation_method` para `manual` ou `parameter_table`, conforme a declaração do revisor.

Essa atualização dispara o trigger de origem, que rejeita a mudança porque o item deixa de satisfazer os estados obrigatórios `pending_review / formula_pending`.

### Impacto

Um item derivado de média não consegue completar a revisão pelo fluxo atual. A validação final também continuará bloqueada porque exige todos os itens revisados e nenhuma fórmula financeira pendente. O resultado prático é um fluxo sem caminho de conclusão para esse tipo de item.

**Classificação:** bloqueador funcional para itens com `source_calculation_item_id`. Não afeta necessariamente itens manuais que não tenham vínculo de origem.

## 2. Correção necessária antes da homologação

Não basta remover a condição do trigger: isso enfraqueceria a integridade do vínculo. A correção deve separar dois momentos:

1. **Criação do item derivado:** manter as regras atuais de origem revisada, mesmo processo/organização, valor inicial copiado, destino/fundamento registrados e estado inicial `earning / formula_pending / pending_review`.
2. **Conclusão do cálculo de destino:** criar operação explícita e auditável para registrar o recálculo efetivo da verba de destino. Deve exigir confirmação, método concluído (`manual` ou `parameter_table`), valor recalculado, memória/evidência, fundamento legal/coletivo e, quando aplicável, referência à tabela de parâmetros. O snapshot deve preservar o valor original da média e registrar separadamente o valor final da verba derivada, autor, data, método, base, período e evidência.
3. **Revisão:** permitir a RPC de revisão somente depois que a operação anterior tiver marcado o cálculo como concluído e removido a condição `formula_pending`. A revisão final não pode tratar mera cópia da média como verba calculada.
4. **Proteção da origem:** manter imutáveis o vínculo, a origem e a evidência original. A alteração do valor derivado deve ser permitida apenas pela nova operação autorizada, com auditoria.
5. **Validação final:** aceitar o item apenas quando o recálculo estiver concluído, o fundamento estiver preenchido e a revisão individual tiver sido registrada.

A implementação deve ocorrer em migration corretiva nova, posterior à migration de validação final, com nova RPC e atualização coordenada do trigger de integridade. Não editar migrations históricas já versionadas.

## 3. Casos de teste obrigatórios para a correção

| ID | Cenário | Resultado esperado |
|---|---|---|
| R16-01 | Criar item derivado a partir de média elegível | Cria earning pendente, preservando valor inicial e origem |
| R16-02 | Tentar revisar item derivado ainda formula_pending | Bloqueado com mensagem clara de recálculo necessário |
| R16-03 | Concluir recálculo manual com evidência e confirmação | Atualiza valor/método/snapshot; mantém item pendente de revisão |
| R16-04 | Concluir recálculo por tabela sem source_parameter_table_id | Bloqueado |
| R16-05 | Concluir recálculo por tabela com referência válida | Registra fonte e snapshot |
| R16-06 | Alterar diretamente amount/method/status via UPDATE | Bloqueado para item derivado |
| R16-07 | Reutilizar RPC de recálculo com origem/processo divergente | Bloqueado |
| R16-08 | Revisar item após recálculo concluído | Marca reviewed e registra evidência |
| R16-09 | Validar processo com item derivado ainda não recalculado | Bloqueado |
| R16-10 | Validar processo com item derivado recalculado e revisado | Pode prosseguir se todos os demais critérios estiverem satisfeitos |
| R16-11 | Tentar alterar a média de origem depois do vínculo | Bloqueado |
| R16-12 | Concorrência em duas tentativas de recálculo do mesmo item | Apenas uma operação efetivada; sem perda de auditoria |

## 4. Observações adicionais da revisão

- A revisão final usa `FOR UPDATE` no processo e conta itens da memória; os testes dinâmicos devem confirmar que operações concorrentes de inclusão/revisão não conseguem ultrapassar a validação final.
- As funções com `SECURITY DEFINER` devem continuar com `search_path` fixo, grants mínimos e validação explícita de `auth.uid()`, membership ativa, organização e perfil.
- O sinalizador de transação `app.termination_final_validation` e `app.termination_item_review` é usado pelos triggers para distinguir alterações feitas pelas RPCs. A homologação deve testar chamadas diretas e o ciclo de vida transacional desses sinalizadores em sessões autenticadas, sem assumir que a UI é uma barreira de segurança.
- A migration corretiva deve ser idempotente e preservar auditoria e compatibilidade com itens não derivados.

## 5. Situação e decisão

- Achado identificado por inspeção estática; ainda não reproduzido em banco, pois as migrations de rescisão não foram aplicadas.
- Nenhuma migration corretiva foi criada nesta etapa: o contrato da operação de recálculo precisa ser implementado e revisado como uma unidade, não por afrouxamento isolado do trigger.
- Nenhuma alteração foi feita no Supabase, nenhuma fixture foi inserida e nenhum dado foi alterado.
- O PR permanece aberto em draft. A implantação das migrations continua bloqueada até autorização expressa e até a correção deste achado.
