# Operações financeiras

## Datas e estados

- `pendente`: participa de projeções por `data_vencimento`.
- `paga`: participa do realizado por `data_realizacao`.
- Para hoje, a interface mostra saldo atual; datas futuras mostram saldo previsto; datas passadas mostram saldo realizado.
- Reabrir remove a realização sem apagar o histórico de recibos correspondente.

## Receitas e despesas

- Exigem conta, valor positivo, tipo e categoria compatível.
- Podem ser únicas, parceladas ou recorrentes.
- Parcelamento distribui centavos sem perder ou criar valor.
- Recorrências possuem horizonte renovável e identificador de série.
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

