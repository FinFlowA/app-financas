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
npm run test:transaction-completion
npm run test:plan-trigger
npm run test:plan-matrix
npm run test:account-deletion
npm run test:offline-queue
npm run test:native-compat
npm run test:release-notes-modal
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

## CI

`.github/workflows/security-ci.yml` executa:

1. Gitleaks em todo o histórico;
2. lint, tipos, segurança e testes mobile;
3. lint, testes e build web;
4. EAS Update somente depois dos três jobs anteriores.

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

