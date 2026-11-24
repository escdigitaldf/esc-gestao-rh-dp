# Etapa 17 — conclusão auditável do recálculo de verbas derivadas

**Objetivo:** resolver o conflito identificado na etapa 16 sem enfraquecer a integridade da média de origem.

## Entregas no branch

1. Migration `20261123120000_complete_derived_termination_calculations.sql`.
2. RPC `complete_payroll_termination_derived_calculation`.
3. Atualização de `validate_payroll_termination_item_source()` para aceitar dois estados legítimos:
   - estado inicial: provento pendente, método `formula_pending`, valor igual ao da média original e sem snapshot de recálculo;
   - estado concluído: provento ainda pendente de revisão, método `manual` ou `parameter_table`, snapshot completo de recálculo e autorização transacional pela RPC.
4. Ação de interface **Concluir recálculo** na memória rescisória para itens derivados ainda em `formula_pending`.

## Contrato da RPC

A operação:
- exige usuário autenticado, confirmação expressa e membership ativa em perfil owner/admin/hr_manager/payroll;
- bloqueia a linha do processo antes do item, serializando com a validação final;
- só aceita item derivado de média vinculado, ainda pendente e com método `formula_pending`;
- exige valor final não negativo, método concluído, evidência e fundamento legal/coletivo;
- exige UUID da tabela de parâmetros quando o método for `parameter_table`, e rejeita tabela quando o método for manual;
- preserva a origem e o valor original da média no snapshot;
- registra valor final, método, evidência, fundamento, operador, data, base, fator e referências informadas;
- mantém o item como `pending_review`; não aprova nem valida automaticamente a verba;
- grava via UPDATE normal, permitindo que a trilha AFTER existente audite a alteração na mesma transação.

A RPC é `SECURITY INVOKER`, tem `search_path` fixo, valida organização/processo e recebe EXECUTE apenas de `authenticated` (revogado de PUBLIC/anon).

## Fluxo operacional

1. Encaminhar a média revisada para a verba de destino.
2. Conferir juridicamente período, base, divisor, critério e regra aplicável.
3. Acionar **Concluir recálculo**, informando valor final, método, evidência e fundamento.
4. O sistema mantém a verba pendente de revisão.
5. Acionar **Revisar item** e registrar conferência individual.
6. Somente depois todos os critérios restantes de checklist e validação final podem ser atendidos.

O valor copiado da média é apenas a origem informativa; não é presumido como valor devido da verba de destino.

## Limites da interface desta entrega

- A interface solicita valor, método, evidência, fundamento e, se necessário, UUID da tabela de parâmetros por diálogos de confirmação.
- Campos detalhados de base, alíquota, período, quantidade e unidade são aceitos pela RPC, mas a interface desta etapa os envia como nulos. A evidência textual é obrigatória; detalhamento estruturado desses campos pode ser ampliado em etapa posterior.
- A interface não lista tabelas de parâmetros para seleção; para método `parameter_table`, o operador informa o UUID da tabela usada. A FK valida a existência, mas a validação de escopo/competência/versão da tabela deve ser coberta pela homologação e pode exigir endurecimento adicional conforme o schema efetivo.
- Não é um motor de cálculo automático. O DP informa o resultado após apuração fora desta ação e registra a evidência.

## Testes de aceite adicionados

| ID | Caso | Esperado |
|---|---|---|
| S17-01 | Item derivado no estado inicial | Aceito apenas com valor igual à origem e método formula_pending |
| S17-02 | Recálculo manual completo | Valor final e snapshot gravados; item continua pending_review |
| S17-03 | Recálculo por tabela sem UUID | RPC rejeita |
| S17-04 | Método manual com UUID de tabela | RPC rejeita |
| S17-05 | Método ausente ou valor negativo | RPC rejeita |
| S17-06 | Sem evidência ou fundamento | RPC rejeita |
| S17-07 | Item sem vínculo de origem | RPC rejeita |
| S17-08 | Processo validado/cancelado | RPC rejeita |
| S17-09 | Usuário sem membership/perfil | RPC rejeita |
| S17-10 | Alteração direta simulando snapshot concluído sem sinal transacional | Trigger rejeita |
| S17-11 | Revisão após recálculo concluído | RPC de revisão pode marcar reviewed |
| S17-12 | Alteração da média de origem após vínculo | Trigger de proteção bloqueia |
| S17-13 | Falha durante auditoria AFTER | Transação inteira reverte |
| S17-14 | Recálculo concorrente com validação final | Bloqueio de linha serializa; não permite recálculo após validação |

## Situação de implantação e validação

- Migration criada no branch; **não aplicada** ao Supabase.
- Nenhuma RPC executada no banco ativo.
- Nenhum dado real ou sintético inserido/alterado.
- Revisão de código e documentação concluídas; testes dinâmicos ainda pendentes.
- A migration 17 depende das cinco migrations de rescisão anteriores e deve ser aplicada somente depois delas, nesta ordem: 1, 2, 3, 4, 5 e 17.
- Não liberar operação de rescisão até aplicar em janela autorizada e executar homologação dinâmica.
