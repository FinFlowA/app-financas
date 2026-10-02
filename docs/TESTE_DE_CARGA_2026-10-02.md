# Teste de carga e capacidade — 02/10/2026

Teste mais recente de capacidade do FinFlow. Mede quantas pessoas o sistema atende ao mesmo tempo, quanto cada uso custa ao banco e quanto espaço e transferência os dados ocupam. Também registra as correções feitas a partir dele, no PR #119 (migration `20261002160000_desempenho_regras_de_acesso.sql`).

## Resumo

- **Antes:** o banco atendia ~5 aberturas do Início por segundo. Com 50 pessoas simultâneas, 95% das aberturas levavam até 14,7 s.
- **Depois das correções:** ~19 aberturas por segundo. Com 50 pessoas simultâneas, 95% abrem em até 1 s, sem erros.
- **Limite atual:** a CPU do plano gratuito do Supabase, não mais o código.
- **Plano gratuito:** os primeiros limites a aparecer são a transferência mensal (5 GB, ~850 usuários ativos por mês) e as conexões em tempo real (200 apps abertos ao mesmo tempo).

## Ambiente

| Item | Valor |
|---|---|
| Projeto | Supabase "FinFlow Teste de Carga" (`ejqurfswcmhwfjpgpzdz`), só para testes |
| Região e plano | us-east-1 e plano gratuito, os mesmos da produção |
| Banco | as migrations da `main` (linha de base e posteriores) |
| Usuários | 200 contas fictícias (`@example.com`) |
| Dados por usuário | 2 contas, 6 categorias, ~600 lançamentos: 300 já realizados nos últimos 12 meses e 5 contas fixas com 60 meses à frente |
| Volume total | 121.828 lançamentos, banco com 52 MB (33 MB só de lançamentos) |
| Script | `scripts/carga/teste-carga.cjs` (comandos em [Testes](./TESTES.md#teste-de-carga)) |

Cada "pessoa" do teste é um robô que repete sem parar:
1. abre o Início, com as mesmas consultas do app;
2. em metade das vezes, lança uma despesa por `execute_manual_financial_action`;
3. espera de 1 a 3 segundos.

É muito mais intenso do que o uso de uma pessoa real. As ondas duram 60 s cada e param quando passam de 20% de erros ou de 15 s de resposta.

## Resultados medidos

Tempos medidos do computador de teste, no Brasil, até o servidor nos EUA. Por isso incluem a ida e volta da internet (cerca de 1 s por abertura para uma pessoa sozinha).

| Pessoas simultâneas | Etapa | Aberturas do Início/s | Metade abre em até | 95% abrem em até | 95% dos lançamentos em até | Erros |
|---|---|---|---|---|---|---|
| 20 | Antes | 5,5 | 1,5 s | 2,6 s | 0,7 s | 0% |
| 20 | Só regras de acesso | 6,0 | 1,2 s | 2,4 s | 0,5 s | 0% |
| 20 | **Final** | **7,6** | **0,5 s** | **0,8 s** | **0,3 s** | 0% |
| 50 | Antes | 4,6 | 7,7 s | 14,7 s | 6,0 s | 0% |
| 50 | Só regras de acesso | 7,0 | 5,4 s | 6,6 s | 1,5 s | 0% |
| 50 | **Final** | **18,8** | **0,5 s** | **1,0 s** | **0,4 s** | 0% |
| 100 | Antes | 5,0 | 17,5 s | 31,6 s | 17,4 s | 0,3% |
| 100 | Só regras de acesso | 6,6 | 11,7 s | 23,2 s | 8,8 s | 0% |
| 100 | Final | 6,3 | 10,9 s | 32,6 s | 11,9 s | 1,6% |

Com 100 robôs, a procura (~35 a 40 aberturas por segundo) passa da CPU do plano gratuito, e as respostas entram em fila.

**Atenção ao repetir:** rodadas pesadas seguidas esgotam o crédito de CPU do plano gratuito. Nesse estado, até chamadas triviais passaram de 4 s, e uma rodada de 50 robôs chegou a 43 s. Os números finais acima foram medidos depois de uma pausa.

## Custo de cada abertura do Início

| Medida | Antes | Depois |
|---|---|---|
| Tempo de banco de `refresh_my_recurring_schedules`, sem nada a criar | 220 ms | 13 ms |
| O mesmo, sob carga (média) | 922 ms | 68 ms |
| Tempo de banco da lista de lançamentos | 201 ms | 2 ms |
| Linhas lidas para mostrar os 600 lançamentos de uma pessoa | 119.704 (a tabela inteira) | 600 |
| Dados transferidos por abertura (600 lançamentos) | 138 KB sem compressão; 8 KB com gzip, 6,5 KB com brotli | igual |
| Espaço por lançamento, com índices | 286 bytes | igual |
| Espaço por usuário com 600 lançamentos | ~170 KB | igual |

O Supabase comprime as respostas quando o cliente pede, e o app, os navegadores e o servidor do site pedem. Os dados do teste se repetem muito; com dados reais, a abertura deve ficar entre 15 e 25 KB comprimida.

## Causas encontradas e correções

1. **`refresh_my_recurring_schedules` com custo quadrático.** A função roda a cada abertura do Início no app e a cada página do site. Ela comparava cada lançamento fixo com todos os lançamentos da pessoa (300 × 600 comparações de texto) mesmo quando não havia nada a criar. Era o maior custo do sistema. A escolha das séries foi reescrita; o resto da função não mudou.
2. **Regras de acesso que liam a tabela de todos os usuários.** O formato "dono = eu OU EXISTS(...)" e `is_parceiro(...)` linha a linha impedia o uso de índice em `transacoes`, `contas` e `caixinhas`. As regras foram reescritas de forma equivalente, com a lista de parceiros calculada uma vez (`ids_parceiros_do_usuario()`).
3. **Consulta paginada por id sem filtro.** Mesmo com as regras novas, `order by id` com `limit` levava o banco a percorrer a tabela em ordem de id. O app (Início, Histórico, Fluxo) e o site (9 pontos) passaram a enviar o filtro explícito de `web/src/lib/transacoes-visiveis.ts`.
4. **Recomendações do advisor com efeito real:** índices em `parcerias`, `transacoes.categoria_id` e `fatura_itens.categoria_id`, e `(select auth.uid())` em `ai_transaction_origins`.

`supabase/tests/desempenho_rls.test.sql` e `desempenho_recorrencias.test.sql` provam que as reescritas mostram e criam exatamente o mesmo que as versões anteriores. As verificações de visibilidade passam com as regras antigas e com as novas, e a renovação cria as mesmas 315 ocorrências nas duas versões. As regras para não reintroduzir o problema estão em [Banco de dados](./BANCO_DE_DADOS.md#desempenho-das-regras-de-acesso).

## Capacidade estimada

Os limites dos planos vêm da documentação do Supabase consultada em 02/10/2026; confira no painel antes de decidir, porque podem mudar.

As linhas de transferência e CPU são estimativas com estas suposições:
- cada usuário ativo abre por dia 10 telas que carregam os lançamentos (Início, Histórico, Fluxo ou páginas do site);
- 15% do uso do dia acontece na hora de pico;
- uma pessoa usando o app pede dados a cada 30 a 60 segundos;
- cada abertura transfere ~20 KB comprimidos, para um usuário com 600 lançamentos.

| Limite | Plano gratuito | Plano Pro (US$ 25/mês) |
|---|---|---|
| Espaço do banco (500 MB × 8 GB) | ~2.900 usuários com 600 lançamentos (~6.400 com 274, a média por usuário ativo na produção em 02/10/2026) | ~50 mil (~110 mil) |
| Lançamentos que cabem | ~1,75 milhão | ~30 milhões |
| Transferência mensal (5 GB × 250 GB) | **~850 usuários ativos por mês** | ~42 mil; acima disso, US$ 0,09 por GB |
| CPU do banco | ~19 aberturas/s: ~550 a 1.100 pessoas usando no mesmo instante, ~45 mil ativas por dia | semelhante no menor servidor; cresce com servidores maiores, pagos à parte |
| Apps abertos ao mesmo tempo (tempo real) | **200** | 500; acima disso, US$ 10 por mil |
| Usuários que entram no mês | 50 mil | 100 mil; acima disso, US$ 0,00325 cada |

Em 02/10/2026, a produção ocupava 21 MB, ou 4% do espaço do plano gratuito.

## O que não foi testado

- **Tempo real:** o Início e o Histórico do app escutam mudanças em `transacoes`, `contas` e `fatura_itens` sem filtrar pela pessoa. Com muitos usuários conectados, cada lançamento de qualquer pessoa é conferido para todos eles. É o próximo ponto a melhorar, por exemplo filtrando por `user_id`.
- **Finn (IA):** depende dos limites do provedor de IA e das cotas do app.
- **Páginas do site:** usam as mesmas consultas e a mesma renovação, mas não foram medidas uma a uma.
- **Transferência:** cada tela que mostra lançamentos baixa a lista inteira. Carregar só o que mudou reduziria bastante o uso dos 5 GB do plano gratuito.

## Como repetir

1. Use o projeto de teste, ou crie outro no plano gratuito, e aplique as migrations da `main` com `supabase db query --linked --project-ref <ref> -f <arquivo>`, em ordem.
2. `node scripts/carga/teste-carga.cjs preparar <ref> 200`: leva ~25 min, porque o login do Supabase Auth é limitado por endereço de internet.
3. Zere as estatísticas com `select extensions.pg_stat_statements_reset()`.
4. `node scripts/carga/teste-carga.cjs rodar <ref> 20,50,100,200 60`: o login das 200 contas leva ~30 min antes das ondas. Para medir só até 50, use `20,50`.
5. Veja as consultas mais caras em `extensions.pg_stat_statements`, ordenando por `total_exec_time`.
6. `node scripts/carga/teste-carga.cjs limpar <ref>` apaga as contas de teste.

Nunca rode contra a produção; o script recusa o projeto de produção.
