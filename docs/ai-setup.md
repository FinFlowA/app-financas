# Configuração da IA financeira do FinFlow

A IA usa a Edge Function `finance-ai`. Nenhuma chave privada deve ser colocada em `.env` com prefixo `EXPO_PUBLIC_`, no aplicativo ou no APK.

## Provedor recomendado

Para o beta de produção, a recomendação inicial é **OpenAI com
`gpt-5.6-luna`**. Consultado em 8 de agosto de 2026, a própria OpenAI posiciona o Luna para
cargas econômicas e de alto volume. Ele oferece saída estruturada, custa
US$ 0,20 por milhão de tokens de entrada e US$ 1,20 por milhão de tokens de
saída no modo Standard e, no Tier 1, possui limites publicados de 500 RPM e
500 mil TPM. Isso remove o teto diário muito baixo que hoje interrompe os testes
na conta gratuita da Groq, mantendo um custo adequado para as franquias do
FinFlow. Confirme sempre os dados nas páginas oficiais de
[orientação de modelos](https://developers.openai.com/api/docs/guides/latest-model),
[preços](https://developers.openai.com/api/docs/pricing) e do
[GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna).

Os perfis suportados e recomendados para avaliação são:

- **recomendação inicial:** OpenAI `gpt-5.6-luna`, com Responses API,
  `store: false`, schema estruturado estrito e `reasoning.effort=low`;
- **menor custo e inferência muito rápida:** plano Developer pago da Groq com
  `openai/gpt-oss-120b`; em 2 de agosto de 2026, custa US$ 0,15/M de entrada e
  US$ 0,60/M de saída e publica 1.000 RPM/250 mil TPM no plano Developer;
- a Edge Function aceita na Groq somente `openai/gpt-oss-20b` ou
  `openai/gpt-oss-120b`, ambos com Structured Outputs estrito. Qualquer outro
  modelo falha fechado na configuração; JSON Object Mode não é usado como
  substituto silencioso para ações financeiras.

Antes de uma liberação ampla, rode o mesmo conjunto de pedidos reais em
português nos dois modelos e compare acerto de intenção, campos solicitados,
latência e custo. Nunca troque automaticamente de provedor durante uma
solicitação: dados financeiros não devem ser reenviados sem uma decisão
explícita de configuração.

O plano gratuito da Groq é adequado para testes curtos, mas não deve ser
tratado como capacidade de produção. Trocar somente a chave gratuita não
aumenta a cota da organização. O FinFlow escolhe um único fornecedor por
requisição e não envia silenciosamente os mesmos dados a um segundo provedor.

Como o contexto contém dados financeiros, habilite **Zero Data Retention** em
Groq Console → Data Controls antes do beta. A Groq informa que o recurso está
disponível a todos os clientes. Na alternativa OpenAI, a integração já envia
`store: false`; ainda assim, revise os controles de retenção da organização e o
contrato aplicável. Consulte as páginas oficiais de
[dados da Groq](https://console.groq.com/docs/your-data) e de
[controles de dados da OpenAI](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint).

## Secrets

Configure no Supabase apenas os secrets do provedor escolhido:

```powershell
npx supabase secrets set FINFLOW_AI_PROVIDER=openai
npx supabase secrets set OPENAI_API_KEY=SUA_CHAVE_PRIVADA
npx supabase secrets set FINFLOW_OPENAI_MODEL=gpt-5.6-luna
npx supabase secrets set FINFLOW_OPENAI_REASONING_EFFORT=low
npx supabase secrets set FINFLOW_AI_ROLLOUT_MODE=beta
npx supabase secrets set FINFLOW_AI_ALLOWED_EMAILS=email-do-teste@example.com
```

Depois de medir qualidade e custo com o mesmo conjunto de testes, mantenha o
Luna ou selecione conscientemente o provedor Groq. A mudança de modelo não
altera a fronteira de confirmação do banco.

Alternativa Groq:

```powershell
npx supabase secrets set FINFLOW_AI_PROVIDER=groq
npx supabase secrets set GROQ_API_KEY=SUA_CHAVE_PRIVADA
npx supabase secrets set FINFLOW_GROQ_MODEL=openai/gpt-oss-120b
npx supabase secrets set FINFLOW_GROQ_REASONING_EFFORT=low
```

Não configure os dois provedores como fallback implícito. Se ambos os secrets existirem, `FINFLOW_AI_PROVIDER` determina qual receberá uma solicitação.
O nome do modelo é obrigatório: a Edge falha de forma segura se a chave ou o
modelo não estiverem explicitamente configurados, evitando mudança inesperada
de preço ou capacidade.

## Disjuntor global de custo

Além da cota individual, a migration cria defaults iniciais para uma produção
paga controlada: 900 consultas/dia, 100/minuto, 5 milhões de tokens/dia e
180 mil tokens/minuto. Eles deixam margem abaixo do TPM inicial dos provedores
pagos recomendados, mas não são valores universais.

Antes de consultar o contexto financeiro, a Edge reserva um slot mínimo que já
protege os limites globais e individuais de RPM/RPD. Depois de montar o contexto,
mas ainda antes de qualquer chamada externa, uma segunda RPC atômica troca esse
slot pelo orçamento conservador real e revalida TPM/TPD sob as mesmas travas da
reserva e da finalização. Se não houver capacidade, o provedor não é chamado.
Isso evita que toda consulta simultânea segure o pior caso durante a leitura do
banco, sem abrir uma janela de gasto não reservado.

Os caps aceitam até 38 mil caracteres de prompt, 2,5 mil de histórico, schema,
envelope e 1.000 tokens de saída. O teto é derivado por bytes UTF-8, sem assumir
a média favorável do português, e fica em 128.013 tokens de entrada. Somado à
saída, permanece abaixo da janela de 131.072 tokens do modelo Groq recomendado;
180 mil TPM comportam até a chamada máxima com 50.987 tokens de margem. Pedidos
normais reservam somente a própria estimativa conservadora, permitindo
concorrência de acordo com o tamanho real. Depois de uma resposta válida, a
reserva é substituída pelo uso informado pelo provedor. Falhas comprovadamente
anteriores ao provedor liberam tokens e não consomem a franquia do usuário, mas
continuam contando nos disjuntores de RPM/RPD para impedir abuso; falhas depois
do início da chamada preservam a reserva, pois podem ter consumido tokens.

Não há repetição externa implícita: cada tentativa corresponde a exatamente uma
reserva. O limite individual padrão é 8 mensagens/minuto e pode ser reduzido
com `FINFLOW_AI_REQUESTS_PER_MINUTE` (1 a 30). Se o administrador configurar um
teto menor que uma única reserva máxima, a Edge retorna contexto grande demais
sem entrar em ciclo de tentativas.

Além da franquia visível, existe um teto diário antiabuso de tentativas por
usuário igual a duas vezes o limite de consultas do plano (Smart: 120, Premium:
400 e beta/desenvolvimento: 600). Uma falha comprovadamente anterior ao provedor
não reduz a franquia comercial exibida nem reserva tokens depois de finalizada,
mas continua contando nesse teto, no RPM individual e nos limites globais de
RPM/RPD. Isso impede que pedidos inválidos de uma única conta consumam as 900
tentativas globais do dia sem penalizar uma falha isolada como consulta de IA.

Somente a Edge com `service_role` pode reservar ou ajustar. Groq Free continua apropriado
apenas para testes manuais muito curtos e não comporta estes defaults nem uma
produção confiável. Antes de liberar usuários, ajuste os quatro valores com
folga sobre RPM/RPD, TPM/TPD e orçamento da conta efetivamente contratada:

```sql
update public.billing_settings
set ai_global_requests_per_day = 900,
    ai_global_requests_per_minute = 100,
    ai_global_tokens_per_day = 5000000,
    ai_global_tokens_per_minute = 180000,
    updated_at = now()
where id = true;
```

Configure também limite de gastos e alertas no painel do provedor. O disjuntor
do banco complementa, mas não substitui, esse controle de cobrança.

## Liberação

Modos aceitos em `FINFLOW_AI_ROLLOUT_MODE`:

- `off`: recurso desligado;
- `beta`: somente e-mails presentes em `FINFLOW_AI_ALLOWED_EMAILS`;
- `plans`: acesso conforme plano e direito retornado pelo servidor.

Enquanto os limites comerciais estiverem globalmente desligados, use `beta`. Só use `plans` depois de ativar e testar assinaturas e cotas.

## Ordem de publicação

1. Fazer backup e revisar todas as migrações novas, de
   `20260802000000_ensure_data_realizacao.sql` até
   `20260808001500_unify_ai_transaction_completion.sql`.
2. Aplicá-las no Supabase respeitando rigorosamente o nome numérico. O bloco
   `20260802000000`–`20260802000600` cria o núcleo da IA, telemetria,
   retenção e contexto agregado; o bloco `20260808000000`–`20260808001500`
   acrescenta monitoramento seguro, recibos offline, hardening das Edges,
   conclusão parcial atômica, elegibilidade, limites monetários, versões
   otimistas e a unificação da baixa feita pela IA com a mesma RPC da interface.
   Não aplique a `01500` antes da `01100`, nem a `01400` antes da
   `00100`.
3. Configurar os secrets.
4. Publicar a Edge Function `finance-ai` com JWT obrigatório.
5. Testar em `beta` com uma conta sem dados reais sensíveis.
6. Validar ações únicas, séries, objetivo e fatura, inclusive repetição do toque em Confirmar.
   Inclua um teste com dois dispositivos: gere a prévia em um, altere o mesmo
   recurso no outro e confirme a prévia antiga. O resultado esperado é
   `AI_ACTION_STATE_CHANGED`, sem escrita financeira e sem consumo da cota de
   ação; depois gere uma nova prévia sobre o estado atual. Repetir a mesma
   confirmação devolve o conflito terminal como replay, sem executar nem criar
   um segundo evento de auditoria.

Compatibilidade segura com dados antigos:

- recorrências antigas sem `[Serie:...]` aceitam somente operação individual, pois duas agendas idênticas não podem ser separadas com segurança; parcelamentos antigos numerados ainda aceitam operação em massa quando o servidor comprova mesmo criador, conta, tipo, categoria, valor, total, mês-base e índices sem duplicidade;
- movimentações sem `[Objetivo:...]` só são associadas pelo nome quando existe exatamente um objetivo acessível correspondente;
- em parcelamentos, `value` representa o total e `installment_value` uma parcela. Exemplo: `3x R$ 100` resulta em `value=300`, `installments=3` e `installment_value=100`.
7. Conferir a telemetria de quantidade de tokens e configurar um limite de gastos no painel do provedor. A telemetria não guarda prompt, contexto nem resposta.
8. Só então publicar o bundle do aplicativo.

## Monitoramento seguro

A migration `20260808000000_ai_safe_monitoring.sql` deve ser aplicada depois
das sete migrations do núcleo; as migrations seguintes, até a `01500`, devem
ser aplicadas na ordem antes de publicar a Edge atualizada. A migration de
monitoramento
acrescenta somente status, provedor, modelo, latência e código técnico de erro
à telemetria existente. Não registra prompt, resposta, descrição, valor,
contexto financeiro nem identificadores na saída do monitor.

O resumo operacional é exclusivo de `service_role` e pode ser consultado no
backend ou SQL Editor com:

```sql
select public.ai_monitor_health(60);
```

O resultado agrega a última hora e informa `healthy`, `attention`, `degraded`
ou `no_data`, além da latência média/P95, erros e divisão por
provedor/modelo/status. Nunca exponha essa RPC no cliente do aplicativo.

Para transformar o resumo em uma verificação automatizável, o repositório traz
`npm run monitor:ai`. Execute-o apenas em uma estação administrativa ou CI,
com `FINFLOW_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e, opcionalmente,
`FINFLOW_AI_MONITOR_WINDOW_MINUTES` definidos como secrets. Ele imprime apenas
contadores, latência e códigos técnicos; retorna código 1 em `attention` e 2 em
`degraded`, permitindo configurar um alerta sem expor conversas ou valores.
Nunca use essas variáveis no bundle Expo nem com prefixo `EXPO_PUBLIC_`.

## Garantias da arquitetura

- prompt de sistema definido somente no servidor;
- allowlist de intents financeiras;
- contexto obtido sob a sessão e RLS do usuário;
- totais e séries agregados no PostgreSQL, com detalhes limitados aos registros relevantes para a pergunta;
- modelo apenas propõe; ele nunca confirma nem executa;
- prévia calculada no banco, não pelo texto do modelo;
- confirmação com token opaco, expiração e idempotência;
- proteção otimista entre prévia e confirmação: atualizações,
  arquivamentos, exclusões, conclusões/reaberturas, séries, movimentos de
  objetivo, compras de cartão e faturas guardam um hash privado do estado-alvo;
  a confirmação recalcula esse hash sob locks de linha e falha fechado se o
  recurso tiver mudado. Criações puras são isentas porque não sobrescrevem
  uma linha existente. A geração da própria prévia faz duas leituras e é
  descartada se detectar uma mudança concorrente entre elas;
- execução transacional e auditada;
- cota diária por plano no horário de Brasília;
- limite separado e visível de consultas ao modelo (Smart: 60/dia; Premium: 200/dia) e telemetria de tokens sem conteúdo financeiro;
- disjuntor global de requisições e tokens ajustável no banco, com reserva exclusiva da Edge;
- análises usam a franquia de consultas, enquanto a franquia de ações conta somente mutações efetivamente confirmadas;
- cada mensagem do histórico, propostas e auditoria operacional sem escrita direta pelo aplicativo e com limpeza global diária após 30 dias; telemetria técnica após 90 dias;
- ações de identidade, segurança, parceria e assinatura fora do alcance da IA.

O fingerprint protege as linhas financeiras que a ação pretende alterar e,
em escopos coletivos, o conjunto de itens da série/fatura. Condições derivadas
como limite do plano, saldo, referências que transformam exclusão em
arquivamento e pagamentos posteriores continuam sendo revalidadas pelo executor
na mesma transação. Se alguma delas mudar, o servidor devolve o erro de domínio
correspondente em vez de forçar a proposta antiga.
