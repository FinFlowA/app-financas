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
- Receitas, despesas e transferências únicas, parceladas ou recorrentes, inclusive de contas para objetivos.
- Recorrências semanais, mensais e anuais, preservando itens já concluídos.
- Conclusão integral ou parcial com data e histórico das baixas.
- Categorias de receita e despesa sincronizadas entre aplicativo e site.
- Objetivos financeiros com guardar, resgatar, projeção e histórico.
- Cartões, compras únicas, parceladas ou fixas, faturas e estornos.
- Pagamento integral ou parcial de fatura, com saldo remanescente e juros opcionais.
- Histórico com busca e filtros por período, status, tipo, conta e categoria.
- Calendário web com agendamentos por dia, filtros de situação e criação direta na data selecionada.
- Fluxo de caixa realizado e previsto, com seleção de múltiplas contas.
- Relatórios por categoria; cada parcela de cartão aparece no mês da sua fatura.
- Assistente restrito a finanças, com prévia e confirmação explícita antes de alterar dados.
- Planos, checkout pelo backend, temas e notificações configuráveis.
- Proteção biométrica no mobile, sessão SSR na web e atualização OTA pelo EAS Update.

## Regras financeiras importantes

- Uma transferência entre contas é uma única movimentação: debita a origem e credita o destino. Transferências para objetivos usam a operação atômica de guardar dinheiro, sem virar despesa.
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
constants/                   catálogos compartilhados entre app e site
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
npm run test:finance-ai-context
npm run test:finance-ai-state-guard
npm run test:history-order
npm run test:money-input
npm run test:password
npm run test:transaction-completion
npm run test:plan-trigger
npm run test:account-deletion
npm run test:offline-queue
npm run test:native-compat
npm run test:release-notes-modal
npm run test:edge-security
npm run test:local-demo
npm audit --omit=dev
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

### Atualização local em validação — 22/08/2026

Esta atualização descreve o estado da árvore de trabalho local. Ela **não
representa publicação** no GitHub, Expo/EAS, Netlify ou Supabase:

- concluir, reabrir e excluir transferências para objetivos passou a usar as
  ações financeiras transacionais do backend, inclusive em ocorrências
  parceladas ou recorrentes;
- guardar e resgatar em objetivo compartilhado usa `move_goal`, preservando
  autorização, lançamento e saldo do objetivo na mesma operação;
- a exclusão de conta foi consolidada em `delete_user()`, com reautenticação
  recente, ordenação dos vínculos financeiros e tratamento dos ledgers de
  conclusão, reabertura e pagamento de fatura;
- app, site e RPC bloqueiam a exclusão enquanto houver parceria/convite,
  decisão de separação ou assinatura pendente, para preservar o financeiro da
  outra pessoa e impedir cancelamentos incompletos;
- recibos de uma transação que pertence a outro usuário são preservados quando
  apenas a conta do ator da operação é excluída;
- o fluxo PKCE mobile aguarda a preparação da recuperação de senha antes de
  abrir a tela correspondente e evita processar duas vezes o mesmo link;
- `.gitattributes` fixa LF para código e migrations, eliminando a divergência
  de fim de linha observada no Windows;
- o CI de segurança inclui explicitamente `test:account-deletion` e
  `test:local-demo`, além das demais verificações listadas acima.

A auditoria npm de 22/08/2026 encontrou zero vulnerabilidades nas dependências
de produção do site. No projeto Expo, ela ainda reporta oito ocorrências altas
da mesma cadeia transitiva de build (`Metro` → `image-size`). O aviso trata de
negação de serviço ao processar imagens especialmente criadas durante o build;
o npm só oferece correção automática por uma atualização principal do Expo.
Essa atualização não foi forçada nesta rodada porque exige migração e novo
binário, e não deve ser misturada com as correções funcionais sem teste nativo.

### Atualização de extrato, conciliação e experiência web — 29/08/2026

- A nova área **Extrato e conciliação**, posicionada abaixo de Contas no site,
  importa arquivos CSV e OFX de até 5 MB por seleção ou arrastar e soltar.
- O arquivo bancário é interpretado localmente e permanece apenas na sessão do
  navegador. O arquivo original e suas linhas cruas não são armazenados no
  banco; somente as decisões confirmadas e identificadores não reversíveis
  usados para impedir conciliação duplicada são persistidos.
- Cada item pode ser conciliado com um lançamento existente, transformado em
  nova receita/despesa ou ignorado. Itens podem ser selecionados e ignorados em
  massa, com opções de selecionar e desmarcar todos.
- A busca de agendamentos aceita trechos do nome e ignora diferenças de caixa e
  acentuação. Sem busca, os candidatos são filtrados por mês, com navegação
  para períodos anteriores e posteriores.
- Valores menores realizam baixa parcial e preservam o restante pendente.
  Valores maiores exigem confirmação para registrar a diferença como juros no
  mesmo lançamento, tanto para receitas quanto para despesas.
- Transferências conciliadas nos dois extratos usam os dois lados da mesma
  movimentação, evitando duplicar o valor ao conferir origem e destino.
- Reabrir uma baixa conciliada libera novamente a respectiva linha do extrato.
- O fluxo de caixa do site e do app passou a usar a mesma base acumulada e a
  mesma paginação de contas. O gráfico web ganhou detalhes ao passar o cursor
  pelo mês, sem o tooltip nativo duplicado, e os relatórios por categoria
  excluem transferências.
- O detalhamento de categorias separa despesas e receitas, apresenta totais e
  balanço quando aplicável e bloqueia a rolagem da tela ao fundo.
- Todas as áreas principais do site possuem ajuda contextual pelo botão `?`,
  com explicação da finalidade, principais ações e regras da tela.
- Site e aplicativo utilizam o mesmo catálogo versionado de categorias iniciais,
  cores e ícones. A complementação automática é limitada a cadastros novos que
  possuam apenas as categorias “Outros”; categorias excluídas pelo usuário não
  são recriadas.
- Os modais de confirmação permanecem centralizados na viewport, bloqueiam a
  rolagem do fundo e mantêm o vínculo correto com formulários renderizados por
  portal, inclusive na exclusão de categorias.

O leitor não extrai dados de PDF nesta versão. Converta o extrato para CSV ou
OFX antes da importação; essa limitação evita interpretar incorretamente PDFs
com layouts bancários não padronizados.

## Deploy do site

O painel precisa de um runtime Next.js completo: usa cookies no servidor, Proxy/Middleware, Server Components, Server Actions e rotas dinâmicas. Portanto, não é compatível com hospedagem puramente estática como GitHub Pages.

Opções verificadas nos documentos oficiais:

| Provedor | Compatibilidade | Observação do plano gratuito |
|---|---|---|
| [Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs) | Runtime nativo do Next.js e plataforma usada em produção | Hobby é destinado a projetos pessoais e não comerciais |
| [Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/) | App Router, SSR, Server Actions e Middleware com OpenNext | Alternativa compatível, mas exige a camada de adaptação do OpenNext |
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

Consulte o [relatório de segurança atual](./docs/security/SECURITY_AUDIT_2026-08-17.md) e os [PoCs seguros](./docs/security/POC_2026-08-17.md).

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
