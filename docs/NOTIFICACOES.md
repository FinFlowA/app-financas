# Notificações do aplicativo

## Como funcionam

- **Lembretes financeiros** são agendados localmente no aparelho (`lib/notifications.ts`, com os textos em `lib/lembretes-vencimento.ts`). Como ficam agendados no sistema, chegam mesmo com o app fechado.
- **Nada é disparado ao abrir o app.** Todo lembrete tem horário fixo (8h, 9h ou 19h). A agenda é refeita só quando os dados ou as preferências mudam; a assinatura inclui a versão da regra (`agenda-v3-sem-aviso-na-abertura`).
- Telas com dados parciais não mexem na agenda; só a tela Início, com todos os dados carregados, reconstrói os lembretes.
- Cada tipo pode ser desligado em **Configurações → Notificações**. Todos começam ligados.
- **Textos:** linguagem formal e natural, **sem emojis** e **sem travessão**. Valores em reais só aparecem no aviso de limite do cartão. `npm run test:app-helpers` falha se algum título ou texto voltar a ter emoji ou travessão.
- O iOS guarda no máximo 64 notificações pendentes por app. Por isso há tetos: até 20 lembretes de vencimento e até 8 avisos de atraso por agenda.
- **Avisos de parceria** não são locais: cada aviso novo em `notificacoes_sistema` aciona a Edge Function `send-system-push`, que envia o push pelo Expo. Chegam com o app fechado. O app não cria uma cópia local desses avisos ao abrir.

## Lista de lembretes

| Preferência | Quando | Título | Texto |
|---|---|---|---|
| Vencimentos do dia | 8h do dia do vencimento, para os próximos 30 dias | Vencimentos de hoje | Hoje vencem 2 despesas e 1 receita. Confira os detalhes no FinFlow. |
| Vencimentos do dia | 19h do mesmo dia, só nos próximos 7 dias | Lembrete de vencimentos | Ainda há 2 despesas com vencimento hoje. Caso já tenham sido resolvidas, marque-as como concluídas no FinFlow. |
| Lançamentos vencidos | Próximas 9h, se houver pendências vencidas | Lançamentos em atraso | Você tem 3 despesas vencidas que ainda não foram concluídas. Confira no FinFlow. |
| Lançamentos vencidos | 9h do dia seguinte a cada vencimento dos próximos 30 dias | Vencimentos de ontem | Ontem venceu 1 despesa, que ainda está pendente. Caso já tenha sido resolvida, marque-a como concluída no FinFlow. |
| Limite do cartão | Próximas 9h, quando o uso passa de 80% | Cartão Nubank com 85% do limite usado | Restam R$ 300,00 de um limite de R$ 2.000,00. |
| Prazos dos objetivos | 9h, 30, 7, 3 e 1 dia antes do prazo e no próprio dia | O prazo do seu objetivo termina em 7 dias | Ainda faltam 40% da meta de "Viagem", com prazo até 30/11/2026. |
| Vencimento da fatura | 9h, 3 dias antes, 1 dia antes e no dia | Fatura do cartão Nubank vence em 3 dias | Separe o valor do pagamento para evitar juros. |
| Vencimento da fatura | (1 dia antes) | Fatura do cartão Nubank vence amanhã | Lembre-se de fazer o pagamento para evitar juros. |
| Vencimento da fatura | (no dia) | Fatura do cartão Nubank vence hoje | Faça o pagamento ainda hoje para evitar juros e encargos. |
| Fechamento da fatura | 9h, 2 dias antes do fechamento | Fatura do cartão Nubank fecha em 2 dias | As compras feitas até o fechamento entram nesta fatura. |
| Fechamento da fatura | 9h do dia do fechamento | Fatura do cartão Nubank fechou hoje | As próximas compras entram na fatura seguinte. |

Nomes, quantidades, porcentagens e datas da tabela são exemplos. Singular e plural seguem a quantidade ("vence"/"vencem", "falta"/"faltam").

## Regras de cada tipo

- **Vencimentos e atrasos:** consideram só despesas e receitas pendentes. Quando um lançamento é concluído, a próxima atualização do Início refaz a agenda sem os avisos dele.
- **Limite do cartão:** o uso é calculado como na tela de Cartões (`limiteUsadoDoCartao`): compras não pagas da fatura atual em diante; compras fixas só contam na fatura atual.
- **Prazos dos objetivos:** objetivos sem prazo ou com a meta já alcançada não geram aviso. A porcentagem que falta é arredondada para cima, então nunca aparece "faltam 0%" enquanto houver valor faltando.
- **Vencimento da fatura:** só é agendado para meses com itens ainda não pagos. Pagar a fatura pelo app cancela na hora os lembretes daquela fatura (`cancelarLembretesDaFatura`, que usa `tipo`, `cartaoId` e `mes` gravados em cada lembrete). No pagamento parcial, isso só acontece quando o restante vai para a fatura seguinte.
- **Toque na notificação:** abre a área correspondente do app (lançamentos de hoje, atrasados, objetivos ou cartões).
