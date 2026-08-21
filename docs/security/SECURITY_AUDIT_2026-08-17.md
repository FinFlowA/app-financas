# Auditoria de Segurança do FinFlow — correções de 17/08/2026

Data da revisão: 17/08/2026

Escopo: continuação de `docs/security/SECURITY_AUDIT_2026-08-15.md`. Este
documento cobre exclusivamente os 5 achados altos e um subconjunto dos
achados médios/baixos daquela auditoria: o que foi corrigido, como foi
verificado ao vivo contra o projeto Supabase `qxnfpnabyytdbzdkklet`, e o que
permanece pendente e por quê.

Tipo de revisão: correção com verificação em produção (leitura de catálogo
Postgres, `supabase migration list`, testes locais). Nenhum dado financeiro
de usuário foi lido, alterado ou exportado.

## Resumo executivo

| Severidade | Da auditoria de 15/08 | Corrigidos agora | Continuam pendentes |
|---|---:|---:|---:|
| Alta | 5 | 4 código + banco, 1 não corrigível por código | 1 (ALTO-05, exige novo binário) |
| Média | 6 | 2 corrigidos, 1 confirmado sem correção disponível | 3 pendentes (infraestrutura/decisão de produto) |
| Baixa | 3 | 2 corrigidos | 1 parcialmente mitigado (BAIXO-01) |

Um achado adicional, não catalogado em 15/08, foi encontrado e corrigido
durante este trabalho: a migração `20260815000200` estava presente no
repositório mas nunca havia sido aplicada ao banco remoto, e uma migração
*posterior* (`20260816000100`) já havia sido aplicada — ou seja, as
migrações estavam sendo publicadas fora de ordem. Ambas estão sincronizadas
agora.

## Achados altos — estado após correção

### ALTO-01 — Migração de compartilhamento não aplicada → **Corrigido e verificado**

**Ação:** antes de aplicar, foi executada a consulta de duplicidade de
parcerias aceitas prescrita na própria migração (`select ... having count(*)
> 1`) contra o banco remoto — **zero duplicidades encontradas**, condição
segura para aplicar. A migração `20260815000200_secure_resource_sharing.sql`
foi então aplicada via `supabase db push --linked --include-all`.

**Verificação ao vivo (17/08/2026):**
- `supabase migration list --linked` mostra `20260815000200` presente em
  local **e** remoto.
- `pg_trigger` confirma `finflow_enforce_single_accepted_partnership` ativo
  (`tgenabled = 'O'`) em `public.parcerias`.
- A função `public.set_financial_resource_sharing` existe no catálogo.

**Achado colateral corrigido:** as migrações estavam sendo aplicadas fora de
ordem cronológica (`20260816000100` antes de `20260815000200`). O
`supabase db push` recusou a operação por padrão (`LegacyDbPushMissingRemoteError`)
até ser executado com `--include-all`, o que serviu como confirmação
adicional do problema antes da correção.

### ALTO-02 — Fluxo implícito com tokens no fragmento → **Corrigido em código**

**Ação:** `lib/supabase.ts` agora configura `flowType: "pkce"` no cliente
Supabase do app mobile. Isso muda o comportamento de todos os links de
e-mail *novos* (recuperação de senha, confirmação de conta): eles passam a
carregar um `code` de uso único, cuja troca por sessão exige o
`code_verifier` salvo apenas no dispositivo que iniciou o fluxo. Um app que
registre o mesmo esquema customizado (`meuappfinancas://`) e intercepte o
link não consegue mais completar a autenticação sozinho.

O ramo legado (tokens no fragmento `#`) foi mantido em
`app/_layout.tsx`, mas apenas como compatibilidade transitória para links já
enviados antes do deploy — comentado explicitamente como código a remover
após a janela de validade desses links expirar (a maioria em poucas horas).

**Não incluído nesta correção:** migração para Android App Links / iOS
Universal Links em domínio HTTPS verificado. Isso exige hospedar
`assetlinks.json`/`apple-app-site-association` em um domínio controlado e
possivelmente reconfigurar o app nas lojas — trabalho de infraestrutura fora
do alcance de uma correção de código, registrado como pendência (ver seção
de pendências).

### ALTO-03 — Exclusão de conta sem step-up no servidor → **Corrigido e verificado**

**Ação:**
- `supabase/migrations/20260817000100_require_step_up_for_account_deletion.sql`
  reescreve `public.delete_user()` para exigir uma autenticação de senha
  recente (últimos 10 minutos), lida do claim `amr` (Authentication Method
  Reference) que o GoTrue já inclui em todo JWT. Sem uma entrada de
  autenticação reconhecível e recente, a função falha fechado com
  `AUTH_STEP_UP_REQUIRED` — **antes** de tocar em qualquer tabela.
- O site (`web/src/app/(dashboard)/configuracoes/actions.ts`) já chamava
  `signInWithPassword()` imediatamente antes de `delete_user()`; agora essa
  chamada é o que efetivamente autoriza a exclusão no servidor, não apenas
  uma checagem decorativa no cliente.
- O app mobile (`app/(tabs)/configuracoes.tsx`) **não fazia** nenhuma
  reautenticação de servidor — só biometria local, que não prova nada ao
  backend. Foi adicionado um modal de senha: o fluxo agora chama
  `signInWithPassword()` e só então `delete_user()`. A biometria/alerta
  anteriores foram mantidos como camada adicional de confirmação de UX, não
  como o mecanismo de segurança.
- Como benefício colateral, o app mobile deixou de apagar tabela por tabela
  no cliente antes de chamar a RPC (risco de exclusão parcial descrito no
  achado original) — toda a exclusão agora acontece dentro da própria
  transação de `delete_user()`.

**Verificação ao vivo (17/08/2026):** a definição atual de
`public.delete_user()` no catálogo remoto contém o bloco de checagem de
`amr`/`AUTH_STEP_UP_REQUIRED` (consulta direta a `pg_proc`/
`pg_get_functiondef`, reproduzível via PoC 4 abaixo).

### ALTO-04 — Parceiro altera saldo de objetivo diretamente → **Corrigido (escopo ajustado) e verificado**

**Decisão de escopo:** o achado original descrevia dois problemas
relacionados, mas de naturezas diferentes:
1. **Autorização** — o parceiro de um objetivo compartilhado pode fazer
   `UPDATE` direto em `saldo_atual` pela API REST, sem nenhum lançamento
   correspondente.
2. **Atomicidade** — mesmo o *dono* grava `saldo_atual` em duas chamadas
   separadas (insere a transação, depois soma o saldo); uma falha de rede
   entre as duas deixa os dois divergentes.

Durante a correção, uma varredura completa do repositório encontrou **três**
pontos que fazem essa escrita em duas etapas — não só o já citado
`app/(tabs)/caixinhas.tsx`, mas também `app/(tabs)/index.tsx` (criar
transação com destino em objetivo) e `app/(tabs)/transacoes.tsx` (reverter
objetivo ao excluir lançamento; ajustar objetivo ao concluir lançamento
pendente). Reescrever os três para a RPC atômica sem um dispositivo real
para testar de ponta a ponta — envolvendo séries recorrentes e conclusão
parcial de fatura — foi avaliado como risco maior do que benefício nesta
sessão.

**O que foi corrigido:** a fronteira de **autorização** foi fechada por
completo. `supabase/migrations/20260817000200_block_direct_goal_balance_write.sql`
adiciona um gatilho `before update of saldo_atual on public.caixinhas` que
bloqueia a escrita **a menos que** o autor da linha (`auth.uid() =
caixinhas.user_id`) seja o próprio dono, ou a escrita venha de dentro de
`private.ai_adjust_goal_balance` (o único caminho usado pela RPC pública
`move_goal`, tanto para o dono quanto para o parceiro em objetivo
compartilhado). Um parceiro que tente `UPDATE` direto por REST é recusado
com `FINFLOW_DIRECT_GOAL_BALANCE_UPDATE_BLOCKED`.

`app/(tabs)/caixinhas.tsx` (a tela dedicada de Guardar/Resgatar) foi migrada
para usar a RPC atômica `execute_offline_financial_action` / `move_goal` em
vez do padrão de duas chamadas — não era estritamente necessário para a
correção de autorização (o dono continua autorizado a escrever direto), mas
elimina também a fragilidade de atomicidade nesse fluxo específico.

**O que continua pendente:** a atomicidade completa para o *dono* nos outros
dois fluxos (`index.tsx`, `transacoes.tsx`) — ver pendências.

**Verificação ao vivo (17/08/2026):** `pg_trigger` confirma
`finflow_enforce_goal_balance_write` ativo (`tgenabled = 'O'`) em
`public.caixinhas`.

### ALTO-05 — Sessão em AsyncStorage no APK 2.0 legado → **Não corrigível por código nesta sessão**

O código-fonte atual já inclui `expo-secure-store` (`app.json`) e a lógica
de migração automática do valor legado para o Keychain/Keystore
(`lib/supabase.ts`) — isso já estava correto antes desta sessão. O problema
descrito pelo achado é que o **binário já publicado e instalado** (o
primeiro APK 2.0) não contém o módulo nativo, e uma atualização OTA não
consegue adicionar um módulo nativo ausente. Isso só se resolve publicando
um novo build (APK/AAB) — uma ação de distribuição fora do alcance de uma
correção de código, e que o handoff anterior já registra como "somente
quando solicitado". Não realizado nesta sessão.

## Achados médios — estado após correção

| Achado | Estado |
|---|---|
| MÉDIO-01 (image-size no pipeline) | **Sem correção disponível.** Confirmado via `npm view image-size versions`: a versão publicada mais recente (2.0.2) ainda está na faixa afetada pelos advisories citados na auditoria original. Nada a fazer até uma versão corrigida ser publicada; mitigação de processo continua sendo a única defesa. |
| MÉDIO-02 (webhook sem freshness) | **Corrigido.** `supabase/functions/_shared/mercado-pago.ts` agora rejeita assinaturas cujo `ts` esteja a mais de 5 minutos do relógio do servidor (para mais ou para menos), antes de computar o HMAC. |
| MÉDIO-03 (CSP `unsafe-inline`) | **Não corrigido — decisão deliberada.** A documentação oficial do Next.js (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` desta versão) esclarece que CSP baseado em nonce **força todas as páginas a renderização dinâmica**, desabilitando geração estática/ISR — o build atual mostra `/login`, `/cadastro`, `/termos`, `/privacidade` e outras como estáticas hoje. Implementar isso sem um ambiente autenticado real para testar todas as rotas foi avaliado como risco desproporcional ao benefício (a própria auditoria de 15/08 já havia confirmado que não há XSS explorável hoje). Registrado como pendência para ser feito com testes completos. |
| MÉDIO-04 (assinatura de EAS Update) | **Não corrigível nesta sessão.** Exige gerar/configurar certificado de assinatura na conta Expo/EAS — ação de conta, não de código. |
| MÉDIO-05 (sem CI/SAST/Dependabot) | **Corrigido.** `.github/workflows/security-ci.yml` roda lint, `tsc`, os scripts `test:*`, `security:check` e `npm audit` (informativo) tanto na raiz quanto em `web/` a cada push/PR para `main`. `.github/dependabot.yml` cobre os dois `package.json` e as GitHub Actions. |
| MÉDIO-06 (schema sem baseline única) | **Não corrigido.** Gerar uma baseline confiável exige dump completo do schema remoto; decidiu-se não arriscar um dump incompleto/incorreto sem revisão adicional. |

## Achados baixos — estado após correção

| Achado | Estado |
|---|---|
| BAIXO-01 (sem varredura de segredos no histórico) | **Parcialmente mitigado.** `gitleaks-action` foi adicionado ao CI (roda em todo push/PR, com histórico completo via `fetch-depth: 0`), cobrindo daqui para frente. Uma varredura única e retroativa de todo o histórico anterior não foi executada nesta sessão. |
| BAIXO-02 (logs com detalhe excessivo) | **Corrigido nos pontos citados na auditoria original.** `app/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/transacoes.tsx` e `app/(tabs)/caixinhas.tsx` agora só imprimem o erro completo quando `__DEV__` é verdadeiro; em produção, o log fica genérico ou é omitido. |
| BAIXO-03 (notificação web revela dado financeiro na tela bloqueada) | **Corrigido.** `web/src/components/notifications/financial-notification-scheduler.tsx` agora sempre mostra título "FinFlow" e corpo genérico ("Você tem uma atualização financeira. Abra o app para ver os detalhes."), independente da categoria. A rota de navegação ao tocar (`event.route`) e a deduplicação (`event.key`) continuam funcionando sem mudança — só o texto exibido ficou genérico. |

## Achado não catalogado, encontrado durante a correção

**Testes locais falham neste ambiente Windows por conversão de fim de
linha, não por regressão real.** Ao rodar a suíte de testes para validar as
correções, `test:transaction-completion`, `test:plan-trigger`,
`test:edge-security` (raiz) e o arquivo `finance-domain.test.ts` (web)
falharam. Investigação confirmou que todos os quatro leem arquivos de
migração `.sql` que o colega commitou terminados em `\n` (LF), mas o
`core.autocrlf=true` deste checkout Windows os converteu para `\r\n` (CRLF)
— os testes buscam substring literal contendo `\n` e não encontram. Nenhum
dos arquivos afetados foi tocado nesta sessão de correções; o conteúdo está
correto, só o terminador de linha mudou na finalização local. Como o CI
adicionado roda em `ubuntu-latest` (que preserva LF), esse problema não deve
aparecer lá. Não corrigido nesta sessão (fora do escopo de segurança), mas
registrado para que não seja confundido com uma regressão real:
recomendação futura é adicionar um `.gitattributes` fixando `eol=lf` para
código-fonte e migrações.

## Pendências priorizadas para a próxima rodada

1. **Atomicidade completa de `saldo_atual` para o dono** — migrar
   `app/(tabs)/index.tsx` (criação de transação com destino em objetivo) e
   `app/(tabs)/transacoes.tsx` (reversão ao excluir, ajuste ao concluir) para
   a mesma RPC `move_goal`, com um dispositivo real para testar séries
   recorrentes e conclusão parcial.
2. **PKCE → App/Universal Links** — hospedar `assetlinks.json`/
   `apple-app-site-association` em domínio HTTPS controlado e remover o
   ramo de compatibilidade do fragmento em `app/_layout.tsx`.
3. **Novo binário mínimo** — publicar APK/AAB contendo `expo-secure-store`
   para encerrar o fallback AsyncStorage do APK 2.0 legado.
4. **CSP com nonce** — implementar com ambiente autenticado real disponível
   para testar todas as rotas dinâmicas/estáticas antes de ativar.
5. **Assinatura de EAS Update** — configurar certificado na conta Expo.
6. **Baseline única do schema** — gerar e validar um dump completo e
   reproduzível.
7. **Varredura retroativa de segredos no histórico Git completo.**
8. **`.gitattributes`** para eliminar a divergência de fim de linha entre
   ambientes.

## Controles reverificados nesta rodada

Além dos pontos específicos de cada correção, foram reconfirmados sem
alteração (mesmo estado que a auditoria de 15/08 já validara):

- nenhum segredo real foi adicionado aos arquivos alterados;
- `tsc --noEmit`, lint e build (`web`) aprovados na raiz e em `web/` após
  todas as mudanças;
- as três RPCs tocadas (`delete_user`, `set_financial_resource_sharing`,
  `ai_adjust_goal_balance`) continuam `SECURITY DEFINER` com
  `search_path = ''` e revogação de `anon`.

## Critério de encerramento

Mantido o mesmo da auditoria de 15/08: alteração versionada, verificação
reproduzível, implantação confirmada no ambiente correto e ausência de
regressão. Todos os itens marcados "Corrigido e verificado" nesta rodada
atendem esse critério com evidência direta contra o banco remoto,
reproduzível via `docs/security/POC_2026-08-17.md`.
