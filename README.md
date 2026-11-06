# ESC - Gestão de RH e DP

SaaS multiempresa para gestão de Recursos Humanos e Departamento Pessoal.

## Stack
- Next.js App Router + TypeScript
- Supabase Auth + PostgreSQL + Row Level Security
- Vercel para hospedagem e deploy contínuo
- GitHub como repositório fonte

## Desenvolvimento
1. Instale Node.js LTS.
2. Execute `npm install`.
3. Configure `.env.local` com:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
4. Execute `npm run dev`.

## Segurança
- Não coloque service_role ou segredos administrativos no navegador.
- Toda tabela com dados de cliente deve possuir organization_id e políticas RLS.
- Dados pessoais e trabalhistas exigem controles de acesso, auditoria, retenção e minimização conforme LGPD.

## Estado
Fundação inicial: autenticação, estrutura visual, dashboard inicial e base multi-tenant. Os módulos operacionais serão entregues por etapas.
