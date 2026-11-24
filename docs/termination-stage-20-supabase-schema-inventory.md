# Etapa 20 — inventário somente leitura do schema Supabase

## Escopo e segurança

Inventário realizado por consultas estritamente de leitura no projeto Supabase `esc-gestao-rh-dp`. Nenhum DDL, DML, migration, fixture, usuário ou dado de negócio foi criado ou alterado. Não foram consultados valores pessoais de colaboradores.

## Identificação do ambiente

- PostgreSQL: 17.11.0.018 (engine 17).
- Região: `sa-east-1`.
- Estado do projeto no momento da consulta: `ACTIVE_HEALTHY`.
- Histórico de migrations no banco: 83 registros.
- Última versão registrada: `20261119155650`.

## Inventário agregado do schema public

| Objeto | Quantidade |
|---|---:|
| Tabelas base | 44 |
| Views | 10 |
| Rotinas/funções | 54 |
| Policies RLS | 81 |
| Triggers não internos | 54 |
| Índices | 166 |

As contagens são metadados estruturais, não contagens de dados pessoais.

## Extensões instaladas

Foram identificadas as extensões instaladas: `btree_gist 1.7`, `pg_stat_statements 1.11`, `pgcrypto 1.3`, `plpgsql 1.0`, `supabase_vault 0.3.1` e `uuid-ossp 1.1`. **pgTAP não está instalado** no banco ativo; sua ausência não impede que seja habilitado em ambiente de teste isolado, mas a configuração deverá ser reproduzida e validada nesse ambiente.

## Divergência de histórico: banco versus repositório

O banco possui 83 migrations registradas. O diretório `supabase/migrations` do branch contém 77 arquivos. As seis migrations iniciais abaixo constam no histórico do banco, mas não foram encontradas no diretório versionado consultado:

| Versão no banco | Nome |
|---|---|
| `20261106212353` | `initial_saas_foundation` |
| `20261106213655` | `organization_onboarding_and_admin` |
| `20261106213702` | `expose_secure_organization_onboarding_rpc` |
| `20261107002826` | `expand_employee_registration_record` |
| `20261107215430` | `prevent_duplicate_payroll_competencies_and_entries` |
| `20261107215753` | `create_payroll_variable_events` |

Isso confirma que não é seguro reconstruir o banco de teste aplicando apenas os 77 arquivos atuais sobre um PostgreSQL vazio. O histórico do banco e a sequência versionada precisam ser reconciliados antes de automatizar o reset.

## Estado das tabelas de rescisão

Consulta por `to_regclass` confirmou que `public.payroll_termination_cases` e `public.payroll_termination_calculation_items` ainda não existem no Supabase ativo. As sete migrations de rescisão continuam exclusivamente no branch Git, não aplicadas ao banco.

## Ambiente isolado — opção de branch Supabase

Foi consultado o custo oficial de um branch de desenvolvimento para a organização vinculada ao projeto:

- **US$ 0,01344 por hora** (cobrança horária).
- O branch não foi criado.
- É necessária autorização explícita antes da criação, pois pode gerar cobrança recorrente enquanto existir.

Um branch de desenvolvimento Supabase é a alternativa preferível para testar sem gravar dados no banco principal, desde que a criação e a aplicação das migrations sejam feitas exclusivamente nele e que o baseline seja conferido. A cobrança horária deve ser considerada e o branch deverá ser removido após a homologação, se não for mais necessário.

## Conclusão

O inventário confirmou as dependências do ambiente e identificou precisamente as seis migrations iniciais ausentes do repositório. Não foi criado um baseline artificial nem foram copiados dados do banco ativo.

## Próxima ação condicionada

A próxima ação segura é obter autorização para criar um branch de desenvolvimento Supabase ao custo informado. Depois da criação, será possível inspecionar o schema isolado, aplicar somente as migrations de rescisão ainda ausentes e executar a suíte de testes. Não haverá merge do branch de banco para produção.
