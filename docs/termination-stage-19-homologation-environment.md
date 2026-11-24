# Etapa 19 — auditoria de prontidão do ambiente de homologação

## Resultado

A implementação do fluxo de rescisão permanece no branch `feat/dsr-normative-validation`, commit de referência `8e67f59cc61b8e4afc3d14861f5dde271cf8055d`. Esta etapa verificou a possibilidade de executar a matriz S18-01 a S18-20 em um PostgreSQL/Supabase isolado.

**Conclusão: a suíte ainda não pode ser executada de forma reproduzível com a estrutura atual do repositório.** Não foram executados testes SQL, pgTAP, concorrência ou rollback. Nenhuma migration foi aplicada ao Supabase ativo e nenhum dado foi gravado.

## Evidências encontradas no branch

- Existem 77 arquivos SQL em `supabase/migrations`.
- O diretório `supabase` contém somente `migrations/`; não há `supabase/config.toml`.
- Não foi encontrado diretório `.github/workflows/` no branch.
- O `package.json` contém somente os scripts `dev`, `build`, `start` e `lint`; não há runner de testes nem dependência pgTAP.
- A sequência versionada começa em 09/11/2026 com migrations incrementais de módulos já existentes. Ela não contém uma migration inicial que crie o schema-base necessário, incluindo `organizations`, `employees`, `organization_memberships` e `payroll_parameter_tables`.
- As migrations de rescisão dependem dessas tabelas e de funções/roles do ambiente Supabase, portanto não é correto presumir que a aplicação das 77 migrations em um PostgreSQL vazio funcionará.
- A compatibilidade das migrations de rescisão com o banco ativo foi anteriormente verificada em modo somente leitura; isso não substitui um baseline reproduzível para banco local.

## Bloqueio de homologação

Sem um baseline versionado ou um dump de schema sanitizado e autorizado, um workflow que simplesmente execute `supabase db reset` ou aplique todos os arquivos em um banco vazio provavelmente falhará em dependências anteriores. Criar fixtures ou stubs artificiais para essas tabelas poderia mascarar diferenças de constraints, funções, extensões, policies, roles e triggers do Supabase real.

A Vercel também recusou a criação de um Preview para o HEAD atual por limite diário da API (`402 payment_required`, recurso `api-deployments-free-per-day`, janela de 24 horas). O Preview anteriormente confirmado como READY pertence ao commit `3febf928185370d354c39385335aaa365cb14801`, não ao HEAD atual.

## Próxima sequência segura

1. Obter um baseline de schema do projeto Supabase, sem dados de negócio, com autorização e procedimento de exportação apropriados.
2. Versionar esse baseline como migration inicial ou fixture estrutural reproduzível, após revisão de segurança para remover secrets, dados pessoais e objetos específicos de produção.
3. Adicionar `supabase/config.toml` compatível com as extensões e configurações efetivamente usadas.
4. Criar workflow GitHub Actions com PostgreSQL/Supabase local descartável, aplicar migrations em ordem e executar pgTAP.
5. Implementar fixtures com duas organizações e claims autenticadas; executar S18-01 a S18-20, inclusive concorrência com duas sessões e rollback transacional.
6. Executar novamente build/lint e gerar Preview do HEAD quando a cota da Vercel permitir.

## Restrições mantidas

- Não conectar o workflow ao projeto Supabase ativo.
- Não aplicar migrations remotas.
- Não inserir fixtures no banco ativo.
- Não fazer merge do PR #2 nem promover deployment para produção.
- Não marcar a Etapa 18 como aprovada antes da execução dos testes.

## Critério de saída

A Etapa 19 conclui a auditoria do ambiente e identifica o bloqueio estrutural. A homologação funcional da Etapa 18 permanece pendente até existir baseline isolado e execução real da suíte.
