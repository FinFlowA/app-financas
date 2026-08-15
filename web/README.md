# FinFlow Web

Painel web oficial do FinFlow, conectado ao mesmo Supabase do aplicativo
mobile. A interface usa Next.js 16, React 19, TypeScript e `@supabase/ssr`.

## Funcionalidades

- Cadastro, confirmação de e-mail, login e recuperação de senha.
- Tutorial inicial e regularização de cadastro/termos obrigatórios.
- Início com seleção independente de contas, saldos, visão mensal e alertas.
- Contas e categorias: criar, editar, arquivar, reativar e excluir com segurança.
- Histórico completo com busca, mês, status, tipos, contas e categorias.
- Receitas, despesas e transferências únicas, parceladas ou recorrentes.
- Conclusão integral ou parcial, histórico de baixas, reabertura e séries.
- Objetivos: criar, editar, guardar, resgatar, recorrências, projeções e histórico.
- Cartões, compras, parcelas, faturas, pagamentos parciais, juros e estornos.
- Fluxo de caixa consolidado por ano e por múltiplas contas.
- Assistente financeiro com prévia e confirmação explícita antes de cada ação.
- Perfil, segurança, tema, privacidade de valores, notificações e conta conjunta.
- Planos e checkout pelo backend seguro do Mercado Pago.
- Termos de Uso e Política de Privacidade.
- PWA instalável, aviso de conexão e alertas financeiros locais enquanto o
  site está aberto. Dados financeiros privados não são armazenados no cache
  público do service worker nem nas preferências de notificação.

Recursos nativos sem equivalente literal no navegador, como biometria do
dispositivo e proteção da tela de aplicativos recentes, são substituídos por
reauthenticação por senha, sessão em cookie seguro, CSP e controle para ocultar
valores.

## Desenvolvimento local

Crie `web/.env.local` a partir de `.env.local.example`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-chave-publicavel
NEXT_PUBLIC_SITE_URL=http://localhost:3100
```

Não use `service_role` nem chaves de IA/pagamentos no site. Esses segredos
pertencem exclusivamente às Edge Functions.

```bash
cd web
npm install
npm run dev -- --port 3100
```

Abra [http://localhost:3100](http://localhost:3100).

## Validação

```bash
npm run lint
npx tsc --noEmit --incremental false
npm test
npm run build
npm audit --omit=dev
```

## Backend necessário

Antes de liberar operações financeiras, aplique todas as migrations do
diretório `../supabase/migrations`. A migration `20260815000100` cria
`execute_manual_financial_action`; a `20260815000200` protege o
compartilhamento de contas/objetivos e precisa existir no banco antes de essa
função ser disponibilizada no site. Elas reutilizam as regras transacionais do
FinFlow e impedem que o navegador altere saldos ou séries diretamente.

No Supabase Auth, cadastre os endereços de redirecionamento do domínio final:

```text
https://seu-dominio/auth/callback?flow=signup
https://seu-dominio/auth/callback?flow=recovery
https://seu-dominio/auth/callback?flow=email-change
```

Também configure `NEXT_PUBLIC_SITE_URL` no provedor de hospedagem. Checkout,
assinaturas e IA dependem das Edge Functions e secrets documentados em
`../docs/billing-setup.md` e `../docs/ai-setup.md`.

Os alertas locais dependem de o site estar aberto, online e autorizado pelo
navegador. Alertas com o navegador fechado exigem uma integração Web Push/VAPID
que ainda não faz parte deste repositório.

## Segurança

- Sessão SSR renovada por proxy e cookies do Supabase.
- Todas as páginas financeiras exigem usuário autenticado.
- Escritas compostas usam RPCs atômicas, idempotentes e protegidas por RLS.
- Ações sensíveis revalidam usuário, propriedade, versão e estado financeiro.
- URLs externas de checkout são limitadas aos domínios oficiais permitidos.
- O assistente não recebe credenciais e nunca executa uma ação sem confirmação.
- O service worker não grava HTML autenticado nem respostas financeiras.
- Cabeçalhos CSP, anti-frame, referrer e permissions policy são definidos no
  `next.config.ts`.

## Estrutura

```text
src/app/(dashboard)/
  assistente/      IA financeira
  cartoes/         cartões, compras e faturas
  categorias/      categorias
  configuracoes/   perfil, parceria e preferências
  contas/          contas ativas e arquivadas
  objetivos/       caixinhas e movimentos
  planos/          assinatura
  relatorios/      fluxo de caixa
  seguranca/       dados de acesso
  transacoes/      histórico e lançamentos
src/components/    autenticação, layout, onboarding e componentes comuns
src/lib/           domínio financeiro, auth e clientes Supabase
public/sw.js        shell PWA sem cache de dados privados
```
