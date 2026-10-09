# Testes e validação

## Aplicativo e núcleo compartilhado

```bash
npm ci
npx tsc --noEmit
npm run lint
npm run security:check
npm run test:finance-ai
npm run test:finance-ai-context
npm run test:finance-ai-state-guard
npm run test:history-order
npm run test:money-input
npm run test:password
npm run test:mfa
npm run test:anti-abuse
npm run test:transaction-completion
npm run test:plan-trigger
npm run test:plan-matrix
npm run test:account-deletion
npm run test:offline-queue
npm run test:native-compat
npm run test:release-notes-modal
npm run test:app-helpers
npm run test:finn-product-guidance
npm run test:flow-screens
npm run test:edge-security
npm run test:local-demo
```

## Site

```bash
cd web
npm ci
npm run lint
npx tsc --noEmit --incremental false
npm test
npm run build
```

O build necessita placeholders ou variáveis válidas para integrações lidas durante renderização. Nunca use secrets reais em logs do CI.

Algumas regras que valem para o site e o app ficam nos testes do site:

- `fluxo-atrasados.test.ts`: o que conta como atraso, o saldo previsto sem os atrasados, os atrasados de meses anteriores entrando nas previsões do mês atual (onde o saldo projetado os soma, `dataNoFluxo`) e a ligação do filtro na página, na visão, no gráfico e no app; e as transferências entre as contas escolhidas (`fluxo-transferencias.ts`), que aparecem nas informações do mês como "Transferências" e "Transferências a fazer" (inclusive atrasadas), sem barra no gráfico e sem mudar o saldo;
- `balanco-cartao.test.ts`: as parcelas do cartão no mês da fatura e o pagamento da fatura fora de Saídas e do Balanço, no site e no app;
- `repeticao-e-visao-do-mes.test.ts`: a periodicidade das parcelas (sem repetição diária) no formulário e na ação do site, e Entradas e Saídas com o que já aconteceu na Visão do mês do site e do app;
- `metas-categorias.test.ts`: o progresso das metas e limites das categorias (realizado, agendado, cartão no mês da fatura e o que fica de fora), as situações da barra, e as telas do site de Categorias, Novo lançamento, Histórico (mês e ano) e atrasados em colunas;
- `relatorio.test.ts`: o relatório em PDF e Excel.
  - Análise:
    - resultado igual ao Balanço do Início e saldo projetado igual ao do Fluxo de caixa;
    - o saldo no fim do mês é o início do seguinte, e resultado e saldo fecham com objetivos, transferências e cartão;
    - pendências a vencer e atrasadas, faturas em aberto à parte e a projeção sempre com os atrasados (a tela não pergunta);
    - contas, categorias e maiores;
    - cartões com a mesma conta da tela Cartões (`totaisDoCartao`);
    - comparação com o período anterior.
  - Filtros: mudam receitas, despesas e listas, nunca os saldos.
  - Detalhamento: data efetiva, o que fica de fora, faturas pelo vencimento e contas escolhidas.
  - Arquivos e acesso: páginas do PDF, abas do Excel com os gráficos, texto do PDF e acesso só para Pro e Plus.
- `relatorio-auditoria.test.ts`: a auditoria dos números do relatório num cenário com cartão (parcelas futuras, fatura vencida e paga), transferências (entre contas, para conta arquivada e no formato antigo), objetivos, atrasados de antes do período e o ano anterior (`__tests__/fixtures/cenario-relatorio.ts`).
  - Saldos: saldo atual igual ao da tela Contas, meses que fecham e encadeiam.
  - Realizado e cartão: realizado só até o mês atual, sem contar duas vezes o cartão.
  - Projeção e pendências: projeção igual à do Fluxo de caixa, a receber e a pagar iguais à lista de pendências e às categorias.
  - Comparação: o mesmo trecho dos dois períodos.
  - Gráficos e Excel: os mesmos números das tabelas.
  - Filtros: de conta, categoria, situação, tipo e cartão.
  - Pontos de atenção da auditoria de 08/10/2026:
    - limite utilizado com o que sobrou de faturas antigas (sem os fixos de meses futuros);
    - lançamento sem data de vencimento sem quebrar o relatório;
    - porcentagens das categorias que somam 100%, iguais no gráfico e na tabela;
    - primeira linha da projeção "a partir de hoje";
    - avisos de saldo de cadastro, transferências pendentes e meta mensal em relatório de vários meses;
    - meses com resultado zero e cada conta fechando lançamento a lançamento;
    - juros de fatura levada para a próxima, fora das despesas;
    - aviso de pagamento de fatura lançado como despesa comum;
    - "Entradas e saídas de dinheiro" no Fluxo de caixa do site e do app.
- `ajuda-contextual.test.ts`: toda aba do menu do site tem a ajuda do Finn cadastrada;
- `seletor-periodo.test.ts`: o mês do calendário do período (Histórico e Relatórios) é clicável e abre a escolha de mês e ano;
- `historico-filtros.test.ts`: no Histórico do site, trocar de mês mantém Todos, Concluídos e Pendentes, e "Limpar filtros" volta para o mês atual;
- `finn-tela.test.ts`: a apresentação do Finn com as mesmas sugestões do app, a cota pela leitura do app e a ajuda aberta pelo cabeçalho, sem o botão flutuante nessa tela;
- `seletor-com-busca.test.ts`: a pesquisa dos seletores do site, com a mesma regra do app, ligada nos campos de categoria, conta e destino;
- `web-notifications.test.ts`: os avisos do site, inclusive o de 80% do limite com a mesma regra da tela Cartões.

`npm run test:app-helpers` cobre os lembretes do app: horários, singular e plural, ausência de emoji e de travessão, e o cancelamento dos lembretes ao pagar a fatura. O limite do aviso de 80% (`limiteUsadoDoCartao`) conta o que sobrou de uma fatura antiga e deixa de fora o fixo de mês futuro. Cobre também a periodicidade (datas, rótulos e descrição base), a nova data dos itens ao editar uma série (`serieTemIntervaloCurto` e `novaDataItemSerie`), a meta e o limite das categorias na fila offline e na tela, e a escolha de mês e ano no Histórico.

## Teste de carga

`scripts/carga/teste-carga.cjs` mede tempo de resposta e erros com muitas pessoas usando o app ao mesmo tempo. Roda **só contra um projeto Supabase de teste**, com as mesmas migrations da produção; o script recusa o projeto de produção.

```bash
node scripts/carga/teste-carga.cjs preparar <ref-do-projeto-de-teste> 200
node scripts/carga/teste-carga.cjs rodar <ref-do-projeto-de-teste> 20,50,100,200 60
node scripts/carga/teste-carga.cjs limpar <ref-do-projeto-de-teste>
```

- `preparar` cria contas fictícias (`@example.com`) com dados de exemplo. E-mails e senhas ficam num arquivo na pasta temporária do sistema, fora do repositório.
- `rodar` executa as ondas (pessoas simultâneas) pelo tempo indicado em segundos. Cada pessoa abre o Início com as mesmas consultas do app e, em metade das vezes, lança uma despesa por `execute_manual_financial_action`.
- `limpar` apaga as contas de teste e o arquivo temporário.
- As chaves do projeto vêm da Supabase CLI (é preciso estar logado) e ficam só na memória.

O plano gratuito do Supabase tem limites de conexões e de processamento; use os resultados para comparar mudanças, não como capacidade final da produção. Rodadas pesadas seguidas esgotam o crédito de CPU do plano gratuito. Nesse caso, até consultas triviais passam de 1 s; espere alguns minutos antes de medir de novo.

### Teste mais recente

O relatório completo do teste de 02/10/2026 está em [TESTE_DE_CARGA_2026-10-02.md](./TESTE_DE_CARGA_2026-10-02.md): ambiente, resultados antes e depois das correções, custo de cada abertura do Início, capacidade estimada por plano do Supabase e o que falta testar.

Em resumo, com 50 pessoas simultâneas, 95% das aberturas do Início passaram de 14,7 s para 1 s, e o limite passou a ser a CPU do plano gratuito (~19 aberturas por segundo). Ao fazer um teste novo, crie um relatório datado no mesmo formato e atualize este link.

## Banco (pgTAP)

`supabase/tests/*.test.sql` testa o comportamento do banco (tetos de segurança, tamanho dos textos, permissões, `pg_net`, registro de push, visibilidade das regras de acesso, renovação das séries fixas, periodicidade das parcelas, metas e limites das categorias e o limite utilizado do cartão) num banco Supabase vazio com todas as migrations aplicadas. Precisa de Docker:

```bash
supabase db start
supabase test db
```

Cada arquivo roda numa transação desfeita no fim (`rollback`), então não deixa dados.

## CI

`.github/workflows/security-ci.yml` executa:

1. Gitleaks em todo o histórico;
2. lint, tipos, segurança e testes mobile;
3. lint, testes e build web;
4. banco: aplica as migrations num Supabase vazio dentro do runner e roda os testes pgTAP;
5. EAS Update somente depois dos quatro jobs anteriores.

## Checklist manual financeiro

- Criar receita e despesa única, parcelada e fixa, nas periodicidades semanal, mensal e anual.
- Mudar a data de uma série com "esta e as próximas" (semanal desloca todos os itens; mensal e anual mudam o dia em cada mês).
- Definir meta e limite em categorias e conferir a barra do mês (realizado, agendado e compra do cartão no mês da fatura); tirar o valor deixando o campo em branco.
- Verificar divisão exata de centavos.
- Concluir integral/parcial com data, juros e desconto.
- Reabrir e conferir recibos.
- Transferir entre contas e para objetivo.
- Concluir transferência agendada mesmo após arquivamento permitido.
- Criar compra em cartão antes/depois do fechamento.
- Pagar fatura total/parcial e estornar.
- Conferir saldos atual, previsto e realizado.
- Conferir que movimentos internos não entram em categoria.

## Checklist manual de navegação

- Voltar de todos os modais e telas intermediárias.
- Alternar abas depois de notificações/configurações sem tela cinza.
- Testar teclado, rolagem, tela pequena e orientação suportada.
- Validar tema claro/escuro e ocultação de valores.
- Confirmar estados vazios, loading e erro.

## Checklist Paddle sandbox

- Preços mensal/anual localizados.
- Checkout autorizado somente com IDs permitidos.
- Webhook sem assinatura retorna não-2xx.
- Evento repetido não duplica customer/assinatura.
- Portal abre somente para usuário autenticado dono do customer.
- Cancelamento agendado mantém acesso até a efetivação.
- `paused`, `past_due` e `canceled` seguem as regras documentadas.

## Critério de conclusão

Uma mudança está pronta quando:

- código e documentação concordam;
- tipos, testes relevantes e build passam;
- migration foi aplicada antes do cliente dependente;
- fluxo manual de maior risco foi validado;
- não há segredo ou dado real em artefatos;
- o resultado foi publicado e monitorado no ambiente correto.

