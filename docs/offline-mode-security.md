# Modo offline seguro — base técnica

O FinFlow agora possui uma fila offline limitada e testável. Ela foi desenhada
para não transformar conveniência em duplicidade financeira ou vazamento local.

## Garantias implementadas

- No Android/iOS, o conteúdo de cada operação fica no `expo-secure-store`
  (Keychain/Keystore), dividido em blocos criptografados. O `AsyncStorage`
  guarda somente uma lista de UUIDs opacos.
- Na web, a fila vive apenas em memória e desaparece ao recarregar a página.
  Nenhum payload financeiro offline é persistido no navegador.
- A fila pertence à sessão autenticada. O usuário não é aceito como argumento
  público dos métodos de listar/remover/sincronizar.
- A RPC compara `auth.uid()` com o usuário esperado antes de executar. Uma troca
  de sessão durante a sincronização não reaplica a ação na conta seguinte.
- Toda operação recebe uma chave UUID idempotente. Se a resposta da rede for
  perdida, o replay devolve o comprovante anterior sem duplicar o lançamento.
- Tokens, senha, sessão, `Authorization`, chave de API ou segredo são rejeitados
  em qualquer nível do payload.
- Limites atuais: 50 itens por usuário, payload de 8 KiB, 5 tentativas, 20 itens
  por sincronização e expiração local em 30 dias. Erros persistidos são somente
  códigos sanitizados, nunca mensagens internas do servidor.
- O servidor aceita no máximo 120 novas ações offline por usuário/hora.

## Escopo seguro nesta etapa

A RPC `execute_offline_financial_action` reaproveita o normalizador, validações
de propriedade/RLS e executor financeiro do backend. As telas já usam a fila
para estas operações:

- no dashboard: criar conta pessoal, categoria e receita/despesa, transferir
  entre contas e movimentar dinheiro de uma conta para um objetivo;
- em Objetivos: criar objetivo pessoal;
- em Cartões: criar cartão e compra no cartão.

O movimento `move_goal` do dashboard entra na fila somente quando existe
equivalência exata com a RPC atômica: aporte único já realizado ou série fixa
inteiramente pendente. A RPC bloqueia conta e objetivo, valida o acesso no
momento do replay e grava o lançamento junto com o ajuste do saldo. Movimento
único pendente, parcelamento e série que mistura a primeira ocorrência realizada
com as futuras pendentes continuam exigindo conexão. O modal de Guardar/Resgatar
da tela Objetivos também permanece online nesta etapa.

Contas e objetivos compartilhados não usam os fluxos de criação offline. Toda
referência utilizada por transferência ou movimentação é revalidada no servidor
quando a conexão volta; se o acesso tiver mudado, a ação falha fechada.

## Edições com conflito otimista

As tabelas `contas`, `categorias`, `caixinhas`, `cartoes` e `transacoes` possuem
agora `version` monotônica e `updated_at`, atualizadas por trigger em toda escrita,
inclusive nas alterações online. Uma edição offline leva a versão que estava na
tela em `expected_version`. A RPC `execute_offline_optimistic_update`:

1. valida usuário, prazo, tamanho, action type, recurso e campos allowlisted;
2. reutiliza os validadores financeiros do servidor para cada novo valor;
3. bloqueia a linha com `FOR UPDATE` e compara `version` com `expected_version`;
4. aplica todo o lote na mesma transação;
5. grava o mesmo tipo de recibo idempotente usado pelas criações.

Se outra escrita alterar a linha antes do replay, a RPC devolve
`OFFLINE_VERSION_CONFLICT` e não modifica campo algum. O painel mostra uma
mensagem segura para revisão e permite remover somente essa falha após confirmação.
Para evitar cadeias baseadas em estado ainda não confirmado, apenas uma edição
pendente por recurso pode ficar na fila por vez.

Edições offline ligadas nas telas:

- conta própria, sem mudar compartilhamento: nome, cor e saldo inicial;
- categoria: nome, cor e ícone;
- objetivo próprio, sem mudar compartilhamento: nome, meta, cor, ícone e prazo;
- cartão: nome, cor, limite, vencimento e fechamento;
- lançamento próprio e individual, sem mudar realizado/pendente: descrição,
  valor, data de vencimento, conta e categoria.

As telas fecham o formulário apenas depois que a ação foi confirmada no servidor
ou gravada com segurança no dispositivo. A sincronização é tentada ao recuperar
a rede, ao voltar ao primeiro plano e ao restaurar a sessão. Sair normalmente da
conta preserva a fila segregada para o próximo login do mesmo usuário; exclusão
explícita da conta remove somente a fila desse usuário. Itens com mais de 30 dias
são expirados e removidos localmente.

## Painel em Ajustes

A seção **Sincronização** mostra quantos itens estão aguardando e quantos estão
com falha. O modal permite tentar **Sincronizar agora** e lista somente metadados
allowlisted: tipo genérico da ação, estado, data e número de tentativas. Payload,
valor, descrição, IDs financeiros, usuário, chave idempotente e erro bruto nunca
são entregues ao componente.

Somente um item já marcado como falho pode ser removido, individualmente e após
confirmação que informa que ele não chegará ao servidor. O painel não possui
ação de limpar tudo. Na web a fila continua apenas em memória; no modo local ela
não envia dados ao banco e desaparece ao recarregar a sessão.

## Operações que continuam online

Alterar o compartilhamento de conta/objetivo, editar recurso compartilhado que
pertence ao parceiro, editar uma série inteira, mudar o estado de um lançamento,
editar compra do cartão, excluir/arquivar/reativar, concluir/reabrir lançamento,
pagar fatura e estornar continuam online-only. Esses fluxos afetam permissões,
conjuntos de linhas ou saldos e não são convertidos em uma atualização genérica.

## Contrato ainda necessário para operações destrutivas

O versionamento cobre edições comuns, mas não torna segura uma exclusão ou mudança
de estado por si só. Para ampliar o escopo ainda são necessários:

1. versões esperadas de todas as linhas afetadas por séries ou faturas;
2. IDs temporários e mapa de dependências para ações encadeadas;
3. tombstones para exclusões e uma tela de resolução de conflitos;
4. recibos próprios para conclusão, reabertura, pagamento e estorno;
5. testes de queda e replay para cada conjunto de invariantes de saldo.

Sem esse contrato, uma edição antiga feita offline poderia apagar uma edição
mais nova de outro dispositivo. A fila falha fechada em vez de assumir isso.

## Validação

Execute:

```bash
npm run test:offline-queue
```

O teste cobre isolamento entre usuários, troca de sessão durante o envio,
replay idempotente, limites/tentativas, rejeição de segredos, armazenamento web
somente em memória, construção allowlisted das edições, conflito de versão,
remoção individual de falhas e o escopo restrito das duas RPCs.
