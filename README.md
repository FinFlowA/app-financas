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
| Pagamentos | Paddle Billing no site; Google Play Billing planejado para o app Android |
| Distribuição mobile | EAS Build e EAS Update |

```text
Aplicativo Expo ─┐
                 ├── Supabase Auth + RLS + RPCs ── PostgreSQL
Painel Next.js ──┘                 │                    │
       │                           └── Edge Function IA └── assinaturas
       └── Paddle Checkout + webhook verificado
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

## Documentação técnica

A referência atual está no [índice de documentação](./docs/README.md):

- [Arquitetura](./docs/ARQUITETURA.md)
- [Ambientes e variáveis](./docs/AMBIENTES_E_VARIAVEIS.md)
- [Banco de dados](./docs/BANCO_DE_DADOS.md)
- [Operações financeiras](./docs/OPERACOES_FINANCEIRAS.md)
- [Notificações](./docs/NOTIFICACOES.md)
- [Pagamentos e planos](./docs/PAGAMENTOS_E_PLANOS.md)
- [Assistente Finn](./docs/ASSISTENTE_FINN.md)
- [Rotas e telas](./docs/ROTAS_E_TELAS.md)
- [Deploy e operação](./docs/DEPLOY_E_OPERACAO.md)
- [Segurança](./docs/SEGURANCA.md)
- [Testes](./docs/TESTES.md)
- [Teste de carga mais recente (02/10/2026)](./docs/TESTE_DE_CARGA_2026-10-02.md)
- [Continuidade](./docs/CONTINUIDADE.md)

Handoffs datados são históricos. Em caso de divergência, prevalecem o código e as migrations da `main`, seguidos pelos documentos acima.

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

Copie `web/.env.local.example` para `web/.env.local`. Além do Supabase e da URL do site, a página de planos requer as variáveis Paddle públicas e server-side descritas em [Ambientes e variáveis](./docs/AMBIENTES_E_VARIAVEIS.md).

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
- [Pagamentos e planos atuais](./docs/PAGAMENTOS_E_PLANOS.md)
- [Configuração legada de pagamentos](./docs/billing-setup.md)
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

### Atualização de notificações, fluxo de caixa e Balanço — 02/10/2026

- **Notificações do app:** nenhum aviso chega ao abrir o app; todos têm
  horário fixo. Os textos ficaram mais naturais e formais, sem emojis e sem
  travessão. Os lembretes de vencimento de uma fatura param quando ela é paga,
  e o aviso de prazo dos objetivos mostra a porcentagem que falta e a data
  final, sem valores. Detalhes em [Notificações](./docs/NOTIFICACOES.md).
- **Filtro "Considerar atrasados"** no fluxo de caixa do site e do app.
  Desligado, os lançamentos vencidos e não concluídos saem do saldo previsto e
  do gráfico. No site, a troca é instantânea e o gráfico anima a mudança.
  Ligado, os atrasados de meses anteriores entram nas previsões do mês atual
  (barras e informações do mês), onde o saldo projetado também os soma.
  O filtro nunca afeta o que já foi concluído.
- **O que o fluxo de caixa mostra:** recebido e pago, a receber e a pagar,
  guardado, resgatado, a guardar e a resgatar em objetivos, e as transferências
  entre as contas escolhidas ("Transferências" e "Transferências a fazer",
  inclusive atrasadas). Essas transferências aparecem só nas informações do
  mês, sem barra no gráfico e sem mudar o saldo, porque o dinheiro só troca de
  conta (`web/src/lib/fluxo-transferencias.ts`). Para uma conta fora da
  seleção, a transferência conta como saída ou entrada.
- **Cartão no Balanço do mês:** com todas as contas, cada compra ou parcela
  entra em Saídas e no Balanço no mês da fatura; o pagamento da fatura fica de
  fora para não contar duas vezes. Regras em
  [Operações financeiras](./docs/OPERACOES_FINANCEIRAS.md).
- **Teste de carga:** `scripts/carga/teste-carga.cjs` simula pessoas usando o
  Início e lançando despesas, em ondas, contra um projeto Supabase de teste
  (recusa o de produção). Uso em [Testes](./docs/TESTES.md) e resultados em
  [Teste de carga de 02/10/2026](./docs/TESTE_DE_CARGA_2026-10-02.md).
- **Desempenho do banco:** a renovação das contas fixas e as regras de acesso
  deixaram de ler a tabela de todos os usuários a cada abertura do app ou
  página do site. Com 50 pessoas simultâneas no teste, o Início passou de
  14,7 s para 1 s (95% das aberturas). Regras em
  [Banco de dados](./docs/BANCO_DE_DADOS.md).
- **Política de privacidade:** descreve o token de push usado nos avisos de
  parceria (site, app e documento).

### Atualização da periodicidade das parcelas e Visão do mês — 05/10/2026

- **Periodicidade das parcelas:** parcelas podem ser semanais, mensais ou
  anuais, como as fixas, no app e no site. Não há repetição diária. Migration
  `20261005120000_periodicidade_das_parcelas.sql`, com testes em
  `supabase/tests/periodicidade_das_parcelas.test.sql`.
- **Datas de séries:** mudar a data de uma série semanal (fixa ou parcelada)
  desloca todos os itens juntos. Antes, no app, uma semanal ia toda para o mesmo dia de
  cada mês.
- **Formulário do site:** "Repetição" e "Periodicidade" em botões separados,
  como no app, em vez de uma lista única.
- **Visão do mês:** Entradas e Saídas mostram só o que já aconteceu, e o
  Balanço é a diferença entre elas, no app e no site. No site, clicar em
  "Balanço atual" abre a explicação, como no app.
- **Cor das contas:** ao lançar no app, cada conta aparece com a cor escolhida.
  Regras em [Operações financeiras](./docs/OPERACOES_FINANCEIRAS.md).
- **Ondas do Início (site):** cada onda do cartão de saldo virou um `<svg>`
  próprio, animado inteiro. O navegador não refaz mais o layout a cada quadro
  enquanto o usuário mexe o mouse ou seleciona texto; a aparência é a mesma.

### Atualização de metas e limites por categoria — 06/10/2026

- **Meta e limite mensais:** ao criar ou editar uma categoria, no app e no
  site, dá para definir uma meta mensal (receitas) ou um limite mensal
  (despesas). A tela de Categorias do site e "Gerenciar Categorias" no app
  mostram a barra do mês: cheia com o que já aconteceu e mais clara com o que
  está agendado. O limite fica laranja a partir de 80% e vermelho ao passar.
  O cálculo é o mesmo nos dois (`web/src/lib/metas-categorias.ts`). Migration
  `20261006120000_metas_e_limites_das_categorias.sql`, com testes em
  `supabase/tests/metas_categorias.test.sql`.
- **Metas e limites de qualquer mês:** nas Categorias do site e em "Gerenciar
  Categorias" no app, setas e escolha de mês e ano mostram meses encerrados
  (meta batida ou limite ultrapassado) e a previsão dos meses futuros (com o
  agendado). No site, o mês vai no endereço (`/categorias?mes=AAAA-MM`). No
  app, "Gerenciar Categorias" ganhou um X para fechar.
- **Histórico:** no site, clicar no mês abre a escolha de mês e ano; no app, a
  janela do período, que só trocava o ano, agora escolhe mês e ano.
- **Novo lançamento (site):** em tela grande a janela usa duas colunas e cabe
  sem rolar; "Parcelas" fica ao lado de "O valor informado é".
- **Atrasados (site):** a janela que abre no Início separa Receitas, Despesas e
  Transferências em colunas, cada uma em ordem de vencimento. Transferências
  atrasadas da conta selecionada passam a aparecer.
  Regras em [Operações financeiras](./docs/OPERACOES_FINANCEIRAS.md).

### Atualização de capturas de tela e período no Histórico — 07/10/2026

- **Capturas de tela:** o app deixou de bloquear capturas e gravação de tela.
  No iOS, os saldos continuam borrados no seletor de aplicativos; no Android,
  a lista de recentes passa a mostrar a tela do app (as duas proteções são a
  mesma trava lá). Detalhes em [Segurança](./docs/SEGURANCA.md).
- **Período no Histórico (app e site):** além do mês, dá para escolher um
  período de/até. Os lançamentos entram pela data efetiva e as faturas pelo
  vencimento; os totais do topo somam o período. Nas setas, o período anda o
  próprio tamanho. No site, ele vai no endereço
  (`/transacoes?inicio=AAAA-MM-DD&fim=AAAA-MM-DD`).

### Tela do Finn no site — 09/10/2026

- **Conversa nova:** o Finn se apresenta com ilustração, saudação pelo nome
  (mesma regra do Início) e as mesmas quatro sugestões do app, cada uma com
  uma linha explicando o que faz.
- **Cabeçalho:** status "online"/"digitando…" como no app, ajuda e "Limpar
  conversa".
- **Cota de consultas:** como no app, um anel à esquerda do campo de mensagem
  (`lib/cota-ia.ts`, a mesma leitura e as mesmas cores do app); o clique mostra
  "X de Y consultas ao Finn restantes hoje" e as ações disponíveis.
- **Conversa:** largura toda, como no app (o Finn à esquerda e a pessoa à
  direita), com balões de no máximo 760px para o texto não virar linhas longas
  demais; "digitando" com três pontos e campo de mensagem que cresce com o
  texto, com botão redondo de enviar.
- **Ajuda:** nesta tela abre pelo "?" do cabeçalho (evento
  `ABRIR_AJUDA_EVENTO` de `contextual-help.tsx`); o botão flutuante não aparece
  ali, porque cobria o botão de enviar no celular.
- **Celular e tablet:** o quadro cabe entre o cabeçalho e a barra de baixo
  (antes ficava parcialmente atrás dela).
- **Apagar histórico:** se a limpeza falha, o erro aparece dentro da janela de
  confirmação (antes ficava escondido atrás dela e parecia que o botão não
  fazia nada). Com proposta pendente, o cancelamento é feito uma vez só: uma
  nova tentativa apenas limpa.
- **Site local:** o Finn não responde em `localhost` (mensagens, cota e
  "Apagar histórico"), porque o servidor do Finn em produção só aceita pedidos
  do site oficial (ver `supabase/functions/_shared/http.ts`).
- Funciona nos temas claro e escuro.

### Pesquisa nos seletores do site — 09/10/2026

- Os campos de categoria (lançamento, edição, compra no cartão e
  Conciliação), conta e destino de transferência têm um campo "Digite para
  pesquisar" no topo da lista (`FinFlowSelect` com `searchable`). A busca é a
  mesma do app (`lib/seletor-busca.ts`): sem acentos, sem maiúsculas e com as
  palavras em qualquer ordem. Com o campo em foco, começar a digitar já abre a
  lista pesquisando; setas, Enter e Esc funcionam.

### Atualização do limite do cartão e do Fluxo de caixa — 08/10/2026

- **Limite utilizado do cartão:** conta tudo o que não foi pago, inclusive o
  que sobrou de faturas de meses anteriores (no cartão de verdade, essa dívida
  continua ocupando o limite). Só os lançamentos fixos de meses futuros ficam
  de fora. Vale na tela Cartões do site (`totaisDoCartao`) e do app, no aviso
  de 80% do app (`limiteUsadoDoCartao`) e do site (`web-notifications.ts`), no
  relatório e no banco: a compra acima do disponível é recusada e o Finn
  responde com o mesmo limite (`private.ai_card_used_limit` e
  `finance_ai_context_snapshot`, migration
  `20261008120000_limite_do_cartao_com_faturas_antigas.sql`, com testes em
  `supabase/tests/limite_do_cartao.test.sql`). Regras em
  [Operações financeiras](./docs/OPERACOES_FINANCEIRAS.md).
- **Fluxo de caixa (site e app):** os totais do mês passaram a se chamar
  "Entradas de dinheiro no mês", "Saídas de dinheiro no mês" e "Entradas menos
  saídas no mês" (no app, "Entradas e saídas de dinheiro"). Os números não
  mudaram: são o dinheiro que entrou e saiu das contas, e a fatura do cartão
  entra quando é paga. O nome evita a confusão com as receitas e despesas do
  Início e dos relatórios, que contam a compra do cartão no mês da fatura.

### Relatórios em PDF e Excel (site)

- Aba **Relatórios** (`/exportar`), só no site: escolha o período (mês ou
  de/até, primeiro bloco da página, com o seletor maior `PeriodNavigator`
  `size="lg"`), as contas, os filtros e as seções. A análise aparece só nos
  arquivos; a página monta o relatório.
- **Análise** (`web/src/lib/relatorio-analise.ts`), sem regra nova: cada número
  sai das funções das outras telas.
  - Resumo: saldo inicial do período, saldo atual, receitas e despesas
    realizadas, resultado, taxa de poupança, a receber e a pagar (a vencer e
    atrasados, com quantidade), saldo projetado, faturas em aberto e destaques
    (saldo crescendo, diminuindo ou estável, melhor e pior mês, meses positivos,
    negativos, sem movimentação e com resultado zero).
  - Evolução mensal: saldo no início do mês, receitas, despesas, resultado e
    saldo no fim do mês (que é o início do seguinte), com os gráficos do saldo e
    de receitas x despesas. Resultado e saldo são coisas diferentes: as colunas
    "Objetivos e transferências" e "Cartão: compras menos faturas pagas" mostram
    o que separa um do outro.
  - Projeção do saldo: a mesma do Fluxo de caixa (saldo de hoje + entradas
    previstas - saídas previstas), mês a mês, sempre com os atrasados incluídos
    (o padrão do Fluxo de caixa; o relatório não pergunta, porque traz tudo e
    os atrasados também aparecem à parte em Valores pendentes). As faturas do
    cartão em aberto, que as outras telas ainda não contam, aparecem à parte
    ("Saldo projetado com as faturas").
  - Contas (saldo no início e no fim do período, receitas, despesas,
    transferências e objetivos, saldo atual e o saldo de cada conta mês a mês),
    categorias (quantidade, realizado, porcentagem, pendente, meta ou limite e
    despesas por categoria mês a mês), maiores despesas e receitas (top 5 ou 10),
    cartões (limite usado e disponível como na tela Cartões, gasto no período,
    fatura atual e próxima, parcelas que faltam) e comparação com o período
    anterior de mesma duração.
- **Regras de cálculo:**
  - resultado como a Visão do mês do Início: receitas e despesas concluídas;
    com todas as contas, a compra do cartão entra no mês da fatura e o pagamento
    da fatura fica de fora, para o mesmo gasto não contar duas vezes;
  - com contas escolhidas, o cartão fica de fora e o pagamento da fatura é
    despesa da conta;
  - transferências e objetivos nunca são receita nem despesa;
  - contas arquivadas ficam de fora, como no Início e no Fluxo de caixa;
  - os filtros de categoria, tipo, situação e cartão mudam receitas, despesas e
    listas, e os saldos e a projeção seguem só as contas (o relatório avisa);
  - realizado vai até o fim do mês atual, o mesmo trecho da evolução mês a mês.
    Meses futuros só entram na projeção, mesmo que já tenham parcelas do cartão
    agendadas;
  - o saldo da seleção é a soma do saldo de cada conta, como na tela Contas,
    inclusive com transferências antigas (em duas linhas);
  - a receber, a pagar, o pendente das categorias e a lista de Pendências saem
    de uma lista só (`itensPendentes`), então os totais sempre batem;
  - em período em andamento, a comparação usa o mesmo trecho dos dois períodos,
    até hoje, e melhor e pior mês contam só meses completos;
  - sem nenhuma receita nem despesa no trecho anterior, a comparação vira o
    aviso "sem dados suficientes no período anterior para comparação"; com
    algum dado, ela aparece normalmente, sem porcentagem sobre base R$ 0,00;
  - o saldo projetado sempre diz para quando é ("Saldo projetado para
    31/12/2026");
  - os destaques mostram meses positivos, negativos, sem movimentação (sem
    receitas nem despesas) e, quando houver, com resultado zero (receitas e
    despesas que se anulam). Contam só os meses completos e, somados, dão o
    número de meses completos;
  - as porcentagens das categorias têm uma casa decimal e somam exatamente
    100% (`porcentagensQueFecham`: o que sobra do arredondamento vai para as
    maiores frações); o gráfico usa as mesmas da tabela;
  - a primeira linha da projeção parte do saldo de hoje e diz isso ("Outubro
    2026 (a partir de hoje, 15/10)");
  - na tabela de contas, a coluna "Transferências, objetivos e faturas" é
    somada lançamento a lançamento, e cada conta fecha: saldo no início +
    receitas - despesas + essa coluna = saldo no fim;
  - lançamento pendente sem data de vencimento (o banco aceita; os apps sempre
    gravam a data) fica fora de a receber, a pagar e da lista, sem quebrar o
    relatório.
- **Avisos no próprio relatório**, só quando o caso aparece:
  - sem lançamentos concluídos antes do período, o saldo inicial é o saldo de
    cadastro das contas;
  - transferências pendentes entre as contas do relatório estão em Valores
    pendentes, mas não mudam o saldo total nem a projeção; objetivos e
    transferências para contas de fora entram nas entradas e saídas previstas;
  - meta e limite das categorias são mensais: com vários meses, o relatório
    sugere comparar com a tabela mês a mês ou com a média por mês;
  - juros de fatura levada para a próxima, na seção Cartões (`jurosDeFatura`):
    só informação, porque estão dentro dos pagamentos de fatura e não entram
    nas despesas;
  - possível pagamento de fatura lançado como despesa comum
    (`possiveisPagamentosDeFaturaManuais`): despesa concluída que fala em
    "fatura" e tem o valor de uma fatura que vence a até 31 dias. O gasto
    contaria duas vezes; o relatório avisa e orienta usar "Pagar fatura", sem
    mudar nenhum valor.
- **Diferenças propositais em relação a outras telas** (documentadas no próprio
  relatório):
  - o Fluxo de caixa mostra entradas e saídas de dinheiro das contas, e a
    fatura do cartão sai quando é paga; aqui, como no Início, são receitas e
    despesas, com a compra do cartão no mês da fatura. A coluna "Cartão:
    compras menos faturas pagas" mostra a diferença;
  - o saldo projetado é o mesmo do Fluxo de caixa; as faturas em aberto, que as
    outras telas ainda não contam, aparecem à parte;
  - com contas escolhidas, o Início conta a transferência para uma conta de fora
    como entrada ou saída, e o relatório não (transferência nunca é receita nem
    despesa);
  - o Histórico soma agendados e o total das faturas, outro conceito.
- Auditoria dos números: `web/src/lib/__tests__/relatorio-auditoria.test.ts`
  (cenário em `__tests__/fixtures/cenario-relatorio.ts`).
- **Detalhamento** (as listas de antes): Receitas, Despesas, Transferências,
  Faturas, Compras no cartão, Pendências e Objetivos, com data efetiva e os
  valores sempre à vista. O filtro Tipo decide o que conta; o detalhamento só
  escolhe as listas do arquivo. Listas que o filtro deixaria vazias ficam
  apagadas e fora do arquivo (`secoesForaDoFiltro`): com Despesas, Receitas e
  Transferências; com Receitas, Despesas, Faturas, Compras no cartão e
  Transferências; com filtro de categoria, Transferências (não têm
  categoria). Ao voltar para Todos, a escolha anterior volta.
- **Arquivos** (`web/src/lib/relatorio-arquivos.ts`), gerados no navegador com
  jsPDF + jspdf-autotable e write-excel-file, carregados só ao gerar.
  - PDF: uma página para cada parte (resumo, evolução, contas, categorias,
    cartões e detalhamento).
  - Excel: abas Resumo, Evolução Mensal, Contas, Categorias, Cartões, Receitas,
    Despesas, Transferências, Pendências, Projeção e Objetivos, com datas e
    valores de verdade e negativos em vermelho.
  - Gráficos: desenhados uma vez (`web/src/lib/relatorio-graficos.ts`); vão
    para o PDF e, como imagem, para o Excel.
- Os valores de cartão vêm de `totaisDoCartao` (`web/src/lib/cartoes-resumo.ts`),
  a mesma função da tela Cartões. O limite utilizado conta o que sobrou de
  faturas antigas, como explicado acima.
- Plano: recurso `report_export`, a partir do Pro (vale quando
  `billing_settings.limits_enabled` estiver ligado).

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

- [Continuidade atual do projeto](./docs/CONTINUIDADE.md)
- [Índice da documentação técnica](./docs/README.md)

### Histórico de handoffs

- [Handoff de 19/09/2026](./docs/HANDOFF_2026-09-19.md)
- [Handoff Paddle de 18/09/2026](./docs/PADDLE_HANDOFF_2026-09-18.md)
- [Handoff de 15/08/2026](./docs/HANDOFF_2026-08-15.md)
- [Handoff de 30/07/2026](./docs/HANDOFF_2026-07-30.md)

### Documentos legais

- [Política de Privacidade](./docs/privacy-policy.md)
- [Termos de Uso](./docs/terms-of-use.md)

## Equipe

O FinFlow é desenvolvido em conjunto por **Gabriel Henrique** e **Luis Henrique Palacio**. A autoria técnica de cada contribuição permanece rastreável no [histórico de commits](https://github.com/FinFlowA/app-financas/commits/main) e na página de [contributors](https://github.com/FinFlowA/app-financas/graphs/contributors).

## Links

- Código-fonte: [FinFlowA/app-financas](https://github.com/FinFlowA/app-financas)
- Expo: [@app-financas/meu-app-financas](https://expo.dev/accounts/app-financas/projects/meu-app-financas)
- Documentos legais: [FinFlowA/finflow-legal](https://github.com/FinFlowA/finflow-legal)

Contribuições, relatos de erro e sugestões são bem-vindos.
