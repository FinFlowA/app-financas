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

- `fluxo-atrasados.test.ts`: o que conta como atraso, o saldo previsto sem os atrasados e a ligação do filtro na página, na visão, no gráfico e no app;
- `balanco-cartao.test.ts`: as parcelas do cartão no mês da fatura e o pagamento da fatura fora de Saídas e do Balanço, no site e no app.

`npm run test:app-helpers` cobre os lembretes do app: horários, singular e plural, ausência de emoji e de travessão, e o cancelamento dos lembretes ao pagar a fatura.

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

O plano gratuito do Supabase tem limites de conexões e de processamento; use os resultados para comparar mudanças, não como capacidade final da produção.

## Banco (pgTAP)

`supabase/tests/*.test.sql` testa o comportamento do banco (tetos de segurança, tamanho dos textos, permissões, `pg_net` e registro de push) num banco Supabase vazio com todas as migrations aplicadas. Precisa de Docker:

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

- Criar receita e despesa única, parcelada e recorrente.
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

