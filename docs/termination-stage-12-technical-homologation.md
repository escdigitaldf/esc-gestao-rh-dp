# Etapa 12 — homologação técnica e lacunas de integração das rescisões

Data da revisão: 23/11/2026  
Branch: `feat/dsr-normative-validation`

## 1. Resultado verificável do preview

- Deployment Vercel do commit `6e5fe80c29d595f815ddb2f76a6df5cf731ad787`: `READY`.
- Preview: https://esc-gestao-rh-r7wczlx4i-pztechs-projects.vercel.app
- O estado READY confirma build/deployment do preview, não valida RPCs, migrations ou operações reais no banco.

## 2. Estado do Supabase ativo — consulta somente leitura

Consulta realizada ao projeto `fvpurcivbryteybiycub`:

| Objeto | Resultado |
|---|---|
| `public.payroll_termination_cases` | Não existe |
| `public.payroll_termination_calculation_items` | Não existe |
| `public.validate_payroll_termination_case(uuid,uuid,text,boolean)` | Não existe |
| `public.review_payroll_termination_calculation_item(uuid,uuid,uuid,text,text,boolean)` | Não existe |

A listagem de migrations consultada também não apresentou as migrations de rescisão. Portanto, o código SQL das etapas 1–11 não está instalado no banco consultado. Nenhuma migration foi aplicada nesta etapa e nenhum dado foi gravado.

## 3. Revisão estática das integrações

| Verificação | Resultado da revisão |
|---|---|
| UI chama RPC de revisão com organização, processo, item, evidência, método e confirmação | Conferido no código |
| UI chama RPC de validação com justificativa e confirmação | Conferido no código |
| RPCs validam usuário e membership ativa com perfil permitido | Presente no SQL |
| Validação bloqueia checklist vazio/incompleto | Presente no SQL |
| Validação bloqueia memória vazia | Presente no SQL |
| Validação bloqueia itens não revisados/bloqueados | Presente no SQL |
| Validação bloqueia fórmula financeira pendente e fundamento vazio | Presente no SQL |
| Snapshot registra aprovador, horário, justificativa, checklist e itens | Presente no SQL |
| Triggers impedem alteração de processo e itens após aprovação | Presentes no SQL |
| Auditoria de INSERT/UPDATE ocorre AFTER write | Presente na migration da etapa 10 |
| Médias encaminhadas sem recálculo de destino são impedidas de revisão final pela UI | Presente no código |
| Fluxo executado em banco com autenticação e RLS | Não executado — objetos ausentes |

## 4. Limitações e pendências de homologação

Não há runner de testes automatizados configurado no `package.json`; os scripts disponíveis são `dev`, `build`, `start` e `lint`. O deployment READY comprova o build de preview, mas não substitui testes transacionais.

A homologação dinâmica depende de um projeto Supabase isolado, com as migrations aplicadas e usuários de teste com papéis distintos. O projeto ativo não foi utilizado como ambiente de teste.

Casos que ainda precisam ser executados em ambiente isolado:

1. INSERT/UPDATE de processo e item com verificação da auditoria AFTER.
2. Revisão por usuário autorizado e rejeição de perfil não autorizado.
3. Rejeição de revisão sem confirmação, evidência ou fundamento.
4. Resolução de `formula_pending` por método manual e por tabela com fonte vinculada.
5. Validação negada para checklist vazio/incompleto, memória vazia, item pendente, bloqueado ou fórmula financeira não concluída.
6. Validação aprovada com todos os requisitos atendidos.
7. Tentativas de UPDATE/INSERT de processo validado e INSERT/UPDATE de itens após validação.
8. Rollback completo quando a gravação de auditoria falhar.
9. Concorrência entre revisão de rubrica e validação final.
10. Verificação de isolamento entre organizações e leitura da auditoria por perfis autorizados.

## 5. Critério de liberação

A etapa 12 fica parcialmente concluída: preview READY e revisão estática concluída; homologação dinâmica e validação de RLS/RPC permanecem pendentes.

Não liberar rescisões para cálculo definitivo, TRCT, desligamento ou recolhimento com base apenas neste preview. Não fazer merge, deploy de produção ou aplicar migrations sem autorização e ambiente de homologação adequado.
