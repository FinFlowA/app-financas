<p align="center">
  <img src="./assets/images/icon-square-v2.png" alt="Logo do FinFlow" width="112">
</p>

<h1 align="center">FinFlow 2.0</h1>

<p align="center">
  Controle financeiro pessoal e compartilhado no aplicativo e na web, usando a mesma conta e as mesmas regras financeiras.
</p>

<p align="center">
  Mantido pela equipe <a href="https://github.com/FinFlowA">FinFlowA</a>.
</p>

[![Expo](https://img.shields.io/badge/Expo-SDK_54-000020?logo=expo&logoColor=white)](https://expo.dev/)
[![React Native](https://img.shields.io/badge/React_Native-0.81-61DAFB?logo=react&logoColor=white)](https://reactnative.dev/)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)

## Visão geral

O FinFlow reúne contas, receitas, despesas, transferências, objetivos, cartões de crédito, relatórios e assistência financeira em uma experiência única. O aplicativo Expo e o painel Next.js compartilham o mesmo Supabase, as mesmas categorias e os mesmos dados.

O histórico técnico permanece disponível em [commits](https://github.com/FinFlowA/app-financas/commits/main) e [contributors](https://github.com/FinFlowA/app-financas/graphs/contributors).

## Funcionalidades

- Cadastro, confirmação de e-mail, login e recuperação de acesso.
- Perfil obrigatório, aceite dos termos e tutorial inicial pulável.
- Contas ativas e arquivadas, seleção independente e compartilhamento controlado.
- Receitas, despesas e transferências únicas, parceladas ou recorrentes.
- Recorrências semanais, mensais e anuais, preservando itens já concluídos.
- Conclusão integral ou parcial com data e histórico das baixas.
- Categorias de receita e despesa sincronizadas entre aplicativo e site.
- Objetivos financeiros com guardar, resgatar, projeção e histórico.
- Cartões, compras únicas, parceladas ou fixas, faturas e estornos.
- Pagamento integral ou parcial de fatura, com saldo remanescente e juros opcionais.
- Histórico com busca e filtros por período, status, tipo, conta e categoria.
- Fluxo de caixa realizado e previsto, com seleção de múltiplas contas.
- Relatórios por categoria; cada parcela de cartão aparece no mês da sua fatura.
- Assistente restrito a finanças, com prévia e confirmação explícita antes de alterar dados.
- Planos, checkout pelo backend, temas e notificações configuráveis.
- Proteção biométrica no mobile, sessão SSR na web e atualização OTA pelo EAS Update.

## Regras financeiras importantes

- Uma transferência entre contas é uma única movimentação: debita a origem e credita o destino.
- Guardar ou resgatar dinheiro de um objetivo é movimento interno e não vira receita ou despesa.
- Movimentações concluídas usam `data_realizacao`; pendentes usam `data_vencimento`.
- O pagamento bancário de uma fatura afeta o saldo da conta, mas não duplica a despesa nos relatórios por categoria.
- Uma compra parcelada gera uma cobrança por parcela. A categoria recebe somente o valor da parcela correspondente a cada `mes_fatura`.
- Séries concluídas não são reabertas quando ocorrências futuras são editadas ou excluídas.
- Ações compostas devem passar pelas RPCs transacionais e idempotentes do Supabase.

## Arquitetura

| Camada | Tecnologias |
|---|---|
| Aplicativo | Expo SDK 54, React Native 0.81, React 19 e Expo Router |
| Painel web | Next.js 16 App Router, React 19 e `@supabase/ssr` |
| Backend | Supabase Auth, PostgreSQL, RLS, RPCs e Edge Functions |
| Persistência local | Expo SecureStore, SQLite e AsyncStorage limitado a preferências/cache |
| IA | Edge Function `finance-ai`, OpenAI ou Groq configurado apenas no servidor |
| Pagamentos | Mercado Pago por Edge Functions e webhook validado no backend |
| Distribuição mobile | EAS Build e EAS Update |

```text
Aplicativo Expo ─┐
                 ├── Supabase Auth + RLS + RPCs ── PostgreSQL
Painel Next.js ──┘                 │
                                   ├── Edge Function da IA
                                   └── Edge Functions de cobrança
```

## Estrutura do repositório

```text
app/                         telas e rotas do aplicativo Expo
  (tabs)/                    Início, Histórico, Objetivos, Fluxo e Ajustes
  chat-ia.tsx                assistente financeiro mobile
assets/                      ícones, logo e imagens do aplicativo
components/                  componentes React Native compartilhados
lib/                         domínio financeiro e integrações mobile
shared/                      contratos compartilhados, inclusive da IA
supabase/
  functions/                 Edge Functions
  migrations/                schema, RLS e RPCs versionados
web/
  src/app/                   rotas, Server Components e Server Actions
  src/components/            layout, autenticação, tutorial e UI
  src/lib/                   domínio web e clientes Supabase SSR
docs/                        setup, handoffs, políticas e auditorias
scripts/                     testes e verificações de segurança
```

## Desenvolvimento local

### Requisitos

- Node.js LTS e npm.
- Conta e projeto Supabase configurados.
- Para o mobile: Android Studio/emulador, dispositivo com Expo Go ou development build.
- Para publicar o app: acesso ao projeto EAS/Expo.

### Aplicativo

```bash
git clone https://github.com/FinFlowA/app-financas.git
cd app-financas
npm install
```

Copie `.env.example` para `.env.local` e preencha somente valores públicos:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=sua-chave-publicavel
EXPO_PUBLIC_FINFLOW_LOCAL_DEMO=false
```

Execute:

```bash
npx expo start
```

Atalhos úteis:

```bash
npm run android
npm run ios
npm run web
```

### Painel web

```bash
cd web
npm install
```

Copie `web/.env.local.example` para `web/.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-chave-publicavel
NEXT_PUBLIC_SITE_URL=http://localhost:3100
```

Depois execute:

```bash
npm run dev -- --port 3100
```

Abra [http://localhost:3100](http://localhost:3100). Consulte também [web/README.md](./web/README.md).

### Banco e Edge Functions

As migrations de `supabase/migrations/` são a fonte versionada do banco. Aplique-as na ordem antes de liberar operações financeiras novas. Os guias específicos estão em:

- [Configuração da IA](./docs/ai-setup.md)
- [Configuração de pagamentos](./docs/billing-setup.md)
- [Testes de segurança](./docs/security-testing.md)
- [Modo offline](./docs/offline-mode-security.md)

No Supabase Auth, cadastre os redirects do endereço final do site:

```text
https://seu-dominio/auth/callback?flow=signup
https://seu-dominio/auth/callback?flow=recovery
https://seu-dominio/auth/callback?flow=email-change
```

## Validação

Aplicativo:

```bash
npm run lint
npx tsc --noEmit
npm run security:check
npm run test:finance-ai
npm run test:history-order
npm run test:money-input
npm run test:transaction-completion
npm run test:offline-queue
```

Site:

```bash
cd web
npm run lint
npx tsc --noEmit --incremental false
npm test
npm run build
npm audit --omit=dev
```

## Deploy do site

O painel precisa de um runtime Next.js completo: usa cookies no servidor, Proxy/Middleware, Server Components, Server Actions e rotas dinâmicas. Portanto, não é compatível com hospedagem puramente estática como GitHub Pages.

Opções verificadas nos documentos oficiais:

| Provedor | Compatibilidade | Observação do plano gratuito |
|---|---|---|
| [Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/) | App Router, SSR, Server Actions e Middleware com OpenNext | Melhor ponto de partida para o MVP; o Free usa uma franquia mensal de créditos |
| [Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs) | Runtime nativo do Next.js | Hobby é destinado a projetos pessoais e não comerciais |
| [Cloudflare Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/) | Next.js completo por OpenNext | Exige adaptação e teste cuidadoso do limite de CPU do Free |
| [Render](https://render.com/docs/web-services) | Web Service Node.js | O serviço Free hiberna quando fica ocioso e não é recomendado pelo provedor para produção |

Antes de publicar:

1. Configure o diretório raiz como `web`.
2. Use `npm run build` e `npm run start` quando o provedor solicitar comandos explícitos.
3. Cadastre as três variáveis `NEXT_PUBLIC_*` mostradas acima.
4. Atualize `NEXT_PUBLIC_SITE_URL` para HTTPS.
5. Adicione os redirects do domínio no Supabase Auth.
6. Valide login, confirmação de e-mail, recuperação de senha, Server Actions, checkout e IA.

O plano gratuito deve ser revisado antes de uso comercial: limites, suspensão por uso e termos mudam com o tempo.

## Builds e atualizações do aplicativo

O projeto permanece na versão `2.0.0`. O perfil e o canal precisam corresponder ao APK instalado.

| Perfil/canal | Uso |
|---|---|
| `development` | development build |
| `preview` | APK de distribuição interna |
| `production` | versão destinada à loja/produção |

APK interno:

```bash
npx eas-cli build --platform android --profile preview
```

Atualização OTA do mesmo APK:

```bash
npx eas-cli update --channel preview --message "descrição objetiva da atualização"
```

Produção:

```bash
npx eas-cli update --channel production --message "descrição objetiva da atualização"
```

Uma alteração nativa, de dependência nativa ou de `runtimeVersion` exige novo build. Mudanças JavaScript compatíveis com o runtime podem ser distribuídas por OTA.

## Segurança

- Nunca versione `.env`, tokens, senhas, `service_role`, chaves de IA ou secrets de webhook.
- Variáveis `EXPO_PUBLIC_*` e `NEXT_PUBLIC_*` fazem parte do cliente e não são secretas.
- Chaves OpenAI/Groq pertencem exclusivamente aos secrets da Edge Function `finance-ai`.
- O navegador e o APK nunca recebem `service_role`.
- RLS deve permanecer ativa em todas as tabelas financeiras.
- Escritas críticas usam autenticação, autorização, controle de versão, idempotência e transação no servidor.
- O assistente prepara ações, mas somente uma confirmação explícita permite executá-las.
- Não publique dumps, relatórios ou PoCs com dados pessoais reais.
- Revogue imediatamente qualquer credencial exposta em commit, conversa ou captura de tela.

Consulte o [relatório de segurança atual](./docs/security/SECURITY_AUDIT_2026-08-15.md) e os [PoCs seguros](./docs/security/POC_2026-08-15.md).

## Estado e continuidade

- [Handoff de 15/08/2026](./docs/HANDOFF_2026-08-15.md)
- [Política de Privacidade](./docs/privacy-policy.md)
- [Termos de Uso](./docs/terms-of-use.md)

## Equipe

O FinFlow é desenvolvido em conjunto por **Gabriel Henrique** e **Luis Henrique Palacio**. A autoria técnica de cada contribuição permanece rastreável no [histórico de commits](https://github.com/FinFlowA/app-financas/commits/main) e na página de [contributors](https://github.com/FinFlowA/app-financas/graphs/contributors).

## Links

- Código-fonte: [FinFlowA/app-financas](https://github.com/FinFlowA/app-financas)
- Expo: [@app-financas/meu-app-financas](https://expo.dev/accounts/app-financas/projects/meu-app-financas)
- Documentos legais: [FinFlowA/finflow-legal](https://github.com/FinFlowA/finflow-legal)

Contribuições, relatos de erro e sugestões são bem-vindos.
