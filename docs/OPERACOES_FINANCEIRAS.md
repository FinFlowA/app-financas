# Operações financeiras

## Datas e estados

- `pendente`: participa de projeções por `data_vencimento`.
- `paga`: participa do realizado por `data_realizacao`.
- Para hoje, a interface mostra saldo atual; datas futuras mostram saldo previsto; datas passadas mostram saldo realizado.
- Reabrir remove a realização sem apagar o histórico de recibos correspondente.

## Receitas e despesas

- Exigem conta, valor positivo, tipo e categoria compatível.
- Podem ser únicas, parceladas ou fixas. Parceladas e fixas têm periodicidade **semanal, mensal ou anual**, escolhida em "Periodicidade" no app e no site. Não há repetição diária.
- Parcelamento distribui centavos sem perder ou criar valor. As parcelas vão de 2 a 120; a periodicidade chega ao banco no campo `installment_frequency`, e sem ele as parcelas são mensais.
- Fixas mantêm um horizonte renovado por `refresh_my_recurring_schedules` a cada abertura do Início. Todas mantêm 5 anos à frente.
- Mudar a data de uma série com "esta e as próximas" desloca todos os itens pelo mesmo número de dias quando a série é semanal, fixa ou parcelada. Nas mensais e anuais, cada item fica no seu mês, no novo dia, limitado ao fim do mês. Como as parcelas não dizem o intervalo na descrição, a série é tratada como semanal quando dois itens estão a menos de 28 dias um do outro. O banco (`ai_execute_transaction_action`) e o Histórico do app (`novaDataItemSerie`) usam a mesma regra.
- Ocorrências já concluídas não devem ser alteradas ao editar/excluir o restante da série.

## Conclusão parcial

Uma baixa parcial mantém o restante no lançamento raiz e registra o valor realizado como evento ligado ao raiz. A soma dos recibos e do saldo restante precisa reconciliar com o valor anterior, incluindo juros ou desconto quando permitidos.

Use as RPCs canônicas; DML direto pode violar o ledger e é bloqueado por triggers.

## Transferências

- Uma transferência entre contas é uma única operação lógica.
- Debita a origem e credita o destino nos cálculos; não aparece como receita/despesa de categoria.
- A descrição contém marcadores internos `[Transf.]` e `[Destino:id]`.
- Transferências parceladas/recorrentes usam também `[Serie:id]`.
- Conclusão e reabertura usam `set_transfer_transaction_status`.
- Arquivar uma conta impede novos lançamentos, mas não impede finalizar uma transferência que já estava agendada e continua autorizada.

## Objetivos

- Guardar reduz a conta e aumenta o objetivo.
- Resgatar reduz o objetivo e aumenta a conta.
- Ambos são movimentos internos, sem categoria e sem efeito na receita/despesa.
- Alteração do saldo do objetivo deve ocorrer na mesma transação da movimentação da conta.
- Objetivos compartilhados dependem de parceria válida e permissão explícita.

## Cartões e faturas

- Compra no cartão não reduz imediatamente o saldo da conta.
- Cada parcela vira um `fatura_item` no mês correto, calculado pelo dia de fechamento.
- Compra fixa mantém ocorrências futuras dentro do horizonte definido.
- Pagamento da fatura cria a movimentação bancária e marca os itens vinculados.
- O relatório por categoria usa as compras; o pagamento bancário da fatura é excluído para não duplicar a despesa.
- Pagamento parcial preserva saldo remanescente; estorno restaura somente itens ligados ao pagamento selecionado.
- Pagar a fatura pelo app cancela na hora os lembretes de vencimento daquela fatura (`cancelarLembretesDaFatura`). Os lembretes só são agendados para meses com itens ainda não pagos.

## Balanço do mês (Início do app e do site)

- **Entradas e Saídas** mostram só o que já aconteceu no mês: o que foi recebido e o que foi pago, mais as compras do cartão da fatura do mês (com todas as contas).
- **Balanço atual** é a diferença entre as duas: Entradas − Saídas.
- O que ainda vai vencer no mês aparece na explicação do Balanço ("Ainda falta receber X e pagar Y"), no "Saldo previsto no fim do mês" e, no site, na linha "A vencer no mês" do cartão.
- Na visão com **todas as contas**, cada compra ou parcela do cartão entra em Saídas e no Balanço no mês da fatura em que cai (`mes_fatura`). Uma compra em 10 parcelas conta uma parcela em cada mês. O pagamento bancário da fatura (`[PagFatura:...]`) fica de fora, então o mesmo gasto não é contado duas vezes. Os ajustes técnicos de pagamento parcial ("Pagamento parcial da fatura" e "Saldo da fatura anterior") também ficam de fora.
- Com **uma conta ou parte das contas** selecionadas, as compras não entram (não têm conta vinculada) e o pagamento da fatura conta como despesa da conta que pagou.
- Guardar ou resgatar dinheiro de objetivos e transferências entre as contas selecionadas não entram no Balanço.
- O saldo das contas e o "Saldo previsto no fim do mês" seguem o dinheiro das contas: a compra no cartão só os afeta quando a fatura é paga.
- No app e no site, tocar ou clicar em "Balanço atual" abre a explicação com a conta feita (já recebido, já pago e, quando houver, a linha do cartão), o que falta receber e pagar no mês e o que não entra no Balanço.

## Fluxo de caixa: considerar atrasados

- Um lançamento está **em atraso** quando ainda não foi concluído e o vencimento é anterior a hoje (data de São Paulo). Lançamentos concluídos nunca são afetados.
- O filtro "Considerar atrasados" vem ligado. Desligado, os atrasados saem do cálculo do fluxo: saldo previsto, linha do gráfico e valores previstos de cada mês e dia.
- O filtro não muda o saldo atual das contas, os valores realizados nem a distribuição por categoria (que usa só lançamentos concluídos).
- A regra fica em `web/src/lib/fluxo-atrasados.ts` (`estaEmAtraso` e `lancamentosDoFluxo`), usada pelo site e pelo app.
- **Site:** a página monta as duas versões do fluxo (com e sem atrasados) e a troca acontece na tela, sem nova busca ao servidor; a URL guarda a escolha com `atrasados=0`, que segue ao trocar mês, visão e contas. O gráfico anima a mudança e respeita a preferência do sistema por menos movimento.
- **App:** a escolha vale enquanto a tela estiver aberta.

## Conciliação bancária

- O site aceita CSV e OFX; o arquivo bruto permanece no navegador.
- O banco recebe apenas decisões confirmadas e fingerprints não reversíveis.
- Uma linha pode ser ligada a lançamento existente, gerar novo lançamento ou ser ignorada.
- Valor menor pode baixar parcialmente.
- Excesso confirmado pode ser registrado como juros separado.
- Transferências podem reconciliar os dois lados sem duplicação.
- Reabrir uma baixa libera novamente a linha correspondente.

## Categorias e relatórios

- Categorias aceitam `receita`, `despesa` ou `ambos` conforme o schema vigente.
- Categorias arquivadas preservam lançamentos antigos.
- No gráfico inicial do site, categorias com o mesmo nome normalizado são agrupadas, ainda que possuam IDs diferentes.
- Transferências, objetivos e pagamentos técnicos de fatura são excluídos dos totais por categoria.

## Idempotência e concorrência

- Repetir a mesma requisição com a mesma chave deve devolver o recibo, não duplicar o lançamento.
- Operações que afetam mais de um recurso travam linhas em ordem estável para evitar deadlock.
- Controle de versão protege edições otimistas.
- Em inconsistência, nenhuma alteração parcial deve permanecer.

