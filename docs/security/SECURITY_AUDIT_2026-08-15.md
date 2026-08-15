# Auditoria de Segurança do FinFlow

Data da revisão: 15/08/2026

Escopo: aplicativo Expo/React Native, site Next.js, Supabase/PostgreSQL, Edge Functions, dependências, configurações de build/OTA e práticas operacionais.

Tipo de revisão: análise estática e testes locais não destrutivos. Nenhuma exploração foi feita contra usuários, pagamentos ou dados de produção.

## Resumo executivo

A auditoria encontrou **0 achados críticos, 5 altos, 6 médios e 3 baixos**. Os riscos prioritários não são chaves vazadas: a varredura atual não encontrou segredo real versionado. Os principais riscos são regras de autorização e integridade financeira, além do fluxo de autenticação móvel.

| Severidade | Quantidade | Situação |
|---|---:|---|
| Crítica | 0 | Nenhuma comprovada |
| Alta | 5 | Exige correção prioritária |
| Média | 6 | Corrigir antes de ampliar a base de usuários |
| Baixa | 3 | 1 corrigida nesta rodada; 2 pendentes de endurecimento |

Prioridade recomendada:

1. Aplicar e validar a migração de compartilhamento que está apenas local.
2. Migrar o login móvel para PKCE e links HTTPS verificados.
3. Proteger a exclusão de conta com reautenticação validada no servidor.
4. Impedir alteração direta do saldo de objetivos e tornar o movimento atômico.
5. Entregar um novo binário para retirar o armazenamento de sessão em texto simples do APK legado.

## Metodologia

Foram revisados:

- código TypeScript/TSX do aplicativo e do site;
- migrações SQL, RLS, funções SECURITY DEFINER e grants;
- Edge Functions de IA, assinatura, SMS e webhook;
- autenticação, sessão, deep links, armazenamento local e fila offline;
- CORS, CSP, redirects, XSS, service worker e cache;
- idempotência, rate limiting e validação de payload;
- configuração Expo/EAS Update;
- dependências npm e arquivos versionados em busca de segredos;
- logs e notificações com possível dado financeiro.

Comandos e testes executados:

- npm run security:check — aprovado;
- npm audit --offline na raiz e em web — 0 avisos no cache local;
- npm audit online na raiz — 10 entradas de severidade alta, todas convergindo nos dois avisos de image-size via Expo/Metro; web — 0 vulnerabilidades de produção;
- npm run lint e npm run lint em web — aprovados;
- npm run test:edge-security;
- npm run test:finance-ai;
- npm run test:finance-ai-context — 68 cenários;
- npm run test:finance-ai-state-guard;
- npm run test:offline-queue;
- npx supabase migration list --linked — leitura do estado de migrações;
- npx supabase functions list — leitura das funções publicadas;
- varreduras estáticas de segredos, sinks de XSS, HTTP inseguro, SQL SECURITY DEFINER, RLS e logs.

As severidades consideram o impacto no FinFlow, não apenas a nota genérica de uma ferramenta.

## Achados críticos

Nenhum achado crítico foi comprovado neste escopo.

## Achados altos

### ALTO-01 — Migração de segurança do compartilhamento não está aplicada no banco vinculado

**Estado:** comprovado por comparação local/remota em 15/08/2026.

O comando npx supabase migration list --linked mostrou a migração 20260815000200 somente na coluna local, sem correspondente remoto.

Evidências:

- supabase/migrations/20260815000200_secure_resource_sharing.sql:24-55 audita participantes com mais de uma parceria aceita;
- supabase/migrations/20260815000200_secure_resource_sharing.sql:99-143 cria a trava que impõe uma única parceria aceita por usuário;
- supabase/migrations/20260815000200_secure_resource_sharing.sql:231-318 impede recurso arquivado de permanecer compartilhado e exige exatamente uma parceria;
- supabase/migrations/20260815000200_secure_resource_sharing.sql:320-354 limpa compartilhamentos antigos sem parceria válida;
- supabase/migrations/20260815000200_secure_resource_sharing.sql:356-386 endurece as políticas de leitura/atualização pelo parceiro;
- supabase/migrations/20260815000200_secure_resource_sharing.sql:388-608 cria a RPC idempotente de compartilhamento.

**Impacto:** o modelo antigo usa um booleano compartilhado e a função public.is_parceiro. Se um usuário terminar uma parceria e formar outra, ou possuir mais de uma parceria aceita por inconsistência/corrida, recursos marcados como compartilhados podem ficar visíveis para uma pessoa que não era a destinatária original. Há risco de exposição de contas e objetivos.

**Correção:**

1. Fazer backup e executar primeiro a consulta de duplicidades descrita na própria migração.
2. Resolver qualquer parceria aceita duplicada.
3. Aplicar 20260815000200 em janela controlada.
4. Repetir supabase migration list --linked e testes com duas contas de laboratório.
5. Criar monitoramento para recursos compartilhados sem exatamente uma parceria aceita.

**Observação:** aplicar esta migração não corrige o ALTO-04; a política de atualização ampla de objetivos continua presente nela.

### ALTO-02 — Fluxo móvel aceita access token e refresh token em custom URL scheme

**Estado:** comprovado no código e na configuração instalada.

Evidências:

- app.json:9 registra o esquema customizado meuappfinancas;
- app/login.tsx:282, app/login.tsx:330 e app/login.tsx:359 enviam confirmação/recuperação para esse esquema;
- app/seguranca.tsx:263 e app/seguranca.tsx:300 repetem o redirect customizado;
- lib/supabase.ts:103-109 cria o cliente sem flowType: "pkce";
- package-lock.json:3457-3464 fixa @supabase/supabase-js 2.111.0; o padrão verificado dessa versão instalada é fluxo implicit;
- app/_layout.tsx:388-405 já possui tratamento de code para PKCE;
- app/_layout.tsx:408-416 mantém o fluxo legado e entrega access_token e refresh_token vindos do fragmento diretamente a setSession.

**Impacto:** esquemas customizados podem ser registrados por outro aplicativo. No fluxo implícito, tokens de sessão aparecem diretamente no link; um aplicativo malicioso que intercepte a abertura pode capturar inclusive o refresh token e assumir a sessão.

**Correção:**

- configurar flowType: "pkce";
- usar Android App Links e iOS Universal Links em domínio HTTPS controlado, com assetlinks.json e apple-app-site-association;
- permitir o esquema legado apenas durante uma transição curta;
- remover o ramo de tokens no fragmento depois da migração;
- revisar redirects permitidos no Supabase;
- revogar sessões se houver suspeita de interceptação.

### ALTO-03 — Exclusão irreversível depende de reautenticação apenas no cliente

**Estado:** comprovado no repositório; a definição efetiva no banco remoto deve ser confirmada antes da correção.

Evidências:

- docs/supabase-migration.sql:82-90 define delete_user como SECURITY DEFINER e apaga auth.users quando id = auth.uid(), sem prova de senha recente, AAL ou nonce;
- supabase/migrations/20260730_secure_subscriptions.sql:270-277 revoga anon, mas concede EXECUTE a todo authenticated;
- web/src/app/(dashboard)/configuracoes/actions.ts:310-356 pede senha no site, mas depois chama a mesma RPC com o JWT normal;
- app/(tabs)/configuracoes.tsx:469-505 usa biometria/alerta somente no dispositivo;
- app/(tabs)/configuracoes.tsx:509-525 apaga várias tabelas separadamente, ignora os erros individuais e só então chama delete_user.

**Impacto:** quem obtiver um JWT válido pode chamar a RPC diretamente, pulando a senha e a biometria da interface. A conta pode ser excluída de forma irreversível. No aplicativo, uma falha intermediária também pode deixar exclusão parcial: dados removidos e identidade ainda ativa.

**Correção:**

- revogar EXECUTE direto de authenticated;
- expor uma Edge Function/RPC que exija step-up recente validado no servidor;
- aceitar apenas nonce curto e de uso único ligado ao usuário e à ação;
- validar no servidor parcerias, assinaturas e decisões pendentes;
- realizar toda a exclusão em uma operação transacional ou job auditável;
- gravar somente identificadores técnicos mínimos no log de auditoria, sem conteúdo financeiro.

### ALTO-04 — Parceiro pode alterar diretamente o saldo de objetivo e o fluxo do app não é atômico

**Estado:** comprovado; afeta integridade financeira.

Evidências:

- supabase/migrations/20260731000100_harden_core_rls.sql:116-133 concede UPDATE das tabelas financeiras a authenticated;
- supabase/migrations/20260731000100_harden_core_rls.sql:7-24 preserva apenas identidade/user_id, não saldo_atual;
- supabase/migrations/20260731000100_harden_core_rls.sql:245-272 permite UPDATE amplo de caixinhas compartilhadas pelo parceiro;
- supabase/migrations/20260815000200_secure_resource_sharing.sql:374-386 mantém essa permissão ampla;
- app/(tabs)/caixinhas.tsx:611-619 insere a transação;
- app/(tabs)/caixinhas.tsx:625-628 atualiza saldo_atual em uma segunda requisição e reconhece a possibilidade de a transação existir sem o saldo.

**Impacto:** um parceiro autenticado pode usar a API REST para definir saldo_atual sem a transferência correspondente. Mesmo sem intenção maliciosa, perda de rede entre as duas requisições deixa transação e objetivo divergentes.

**Correção:**

- impedir UPDATE direto de saldo_atual por cliente/parceiro;
- criar trigger de proteção de colunas sensíveis ou grants por coluna;
- obrigar uma RPC atômica para guardar/resgatar;
- usar idempotency key, trava da conta/objetivo e validação de saldo dentro da transação;
- migrar aplicativo, site, fila offline e IA para a mesma RPC;
- criar reconciliação entre saldo do objetivo e movimentos.

### ALTO-05 — APK 2.0 legado mantém sessão do Supabase no AsyncStorage

**Estado:** comprovado e restrito ao primeiro binário 2.0 sem módulo nativo.

Evidências:

- lib/supabase.ts:30-38 documenta que o primeiro APK 2.0 não possui Expo SecureStore;
- lib/supabase.ts:53-75 lê e grava a sessão no AsyncStorage quando o módulo nativo não existe;
- app.json:66 inclui expo-secure-store em novos builds;
- lib/supabase.ts:61-68 migra o valor legado ao cofre quando um binário novo é instalado;
- app.json:20 desabilita backup Android, reduzindo parte do risco.

**Impacto:** no APK legado, access/refresh token persistem sem criptografia no armazenamento privado da aplicação. Um dispositivo com root/jailbreak, depuração indevida, malware privilegiado ou backup fora da política pode expor a sessão. Uma atualização OTA não consegue adicionar o módulo nativo ausente.

**Correção:**

- publicar um novo APK/AAB/IPA contendo expo-secure-store; OTA não basta;
- estabelecer versão mínima obrigatória para o binário legado;
- ao migrar, apagar imediatamente o valor antigo após gravar no Keychain/Keystore;
- limitar duração/rotação de refresh tokens e encerrar sessões antigas;
- validar a versão final com MobSF e inspeção física do armazenamento em aparelho de teste.

## Achados médios

### MÉDIO-01 — Dependência transitiva vulnerável no pipeline Metro

**Escopo:** build/desenvolvimento, não runtime do aplicativo instalado.

Evidências:

- package-lock.json:9540-9563 mostra Metro 0.83.3 dependendo de image-size ^1.0.2;
- package-lock.json:8093-8105 resolve image-size 1.2.1;
- npm ls confirmou o caminho Expo → @expo/metro → metro → image-size;
- npm audit offline retornou zero porque o cache local não continha os avisos;
- npm audit online reportou 10 entradas altas na árvore, todas derivadas da mesma cadeia Expo/Metro/image-size;
- os avisos oficiais [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) e [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) classificam versões até 2.0.2 como afetadas por loop infinito ao analisar imagens ICNS/JXL/HEIF.

**Impacto:** um asset malicioso admitido no repositório ou pipeline pode travar o processo Node/Metro. O aplicativo não recebe imagem de usuário e a passa ao Metro em runtime; portanto, o risco prático é indisponibilidade de build/CI, não invasão remota do app.

**Correção:**

- aceitar no pipeline apenas assets revisados e formatos esperados;
- não executar Metro automaticamente sobre artefatos externos;
- acompanhar atualização compatível de Expo/Metro/image-size;
- não usar npm audit fix --force com downgrade incompatível;
- adicionar uma checagem explícita desse pacote enquanto o advisory não aparece no npm audit.

### MÉDIO-02 — Webhook valida HMAC, mas não rejeita timestamp antigo

Evidências:

- supabase/functions/_shared/mercado-pago.ts:59-81 exige ts e inclui o valor no HMAC, porém nunca compara sua idade com o relógio;
- supabase/functions/mercado-pago-webhook/index.ts:80-95 usa payload.id como chave do evento;
- a assinatura cobre dataId, requestId e ts, mas não o payload.id;
- supabase/functions/mercado-pago-webhook/index.ts:117-160 busca o estado autoritativo no provedor, impedindo falsificação direta do plano;
- supabase/migrations/20260808001000_harden_external_edges.sql:749-769 remove recibos antigos.

**Impacto:** uma requisição assinada capturada pode ser repetida por tempo indefinido. Alterar apenas o identificador de evento do payload pode contornar a deduplicação e forçar novas consultas ao Mercado Pago. A validação autoritativa reduz o impacto à disponibilidade/custo; não foi encontrada forma de conceder plano falso.

**Correção:**

- rejeitar timestamp fora de uma janela curta, por exemplo cinco minutos, com tolerância documentada;
- ligar a idempotência a dados assinados e normalizados;
- adicionar rate limit global/IP no endpoint público;
- manter a consulta autoritativa existente.

### MÉDIO-03 — CSP do site permite script inline

Evidência: web/next.config.ts:22-36 configura CSP, mas script-src contém unsafe-inline; unsafe-eval é adicionado somente em desenvolvimento.

**Impacto:** não foi encontrada API de HTML bruto do React, execução dinâmica de código ou escrita direta no documento, então não há XSS comprovado. Contudo, unsafe-inline reduz a proteção caso um sink seja introduzido futuramente.

**Correção:** usar nonce por requisição ou hashes compatíveis com Next.js; manter unsafe-eval somente em ambiente de desenvolvimento; validar a política com CSP Report-Only antes da ativação.

### MÉDIO-04 — Atualizações OTA não têm assinatura independente configurada

Evidências:

- app.json:78-81 define runtimeVersion e endpoint EAS Update;
- eas.json:7-23 separa canais development, preview e production;
- não existe codeSigningCertificate/metadata de assinatura de update no app.json.

**Impacto:** a cadeia de confiança depende integralmente da conta Expo/projeto e dos controles do pipeline. Comprometimento dessa conta pode publicar JavaScript malicioso no canal compatível. A runtimeVersion estática também exige disciplina manual para não enviar código incompatível com o binário.

**Correção:** configurar EAS Update code signing, MFA obrigatório, menor privilégio, branch/canal de produção protegido, revisão antes de publicação e rotação documentada do certificado.

### MÉDIO-05 — Não há CI de segurança, SAST ou atualização automatizada de dependências

Evidências:

- não há diretório .github versionado;
- os dois package-lock.json estão versionados e permitem builds reprodutíveis;
- eslint-plugin-security existe, mas as verificações dependem de execução manual.

**Impacto:** regressões de RLS, segredo, lint e dependência vulnerável podem chegar à branch principal sem bloqueio. O caso image-size demonstra que depender de uma única fonte também deixa lacunas.

**Correção:** adicionar CI com lint, testes, security:check, npm audit, CodeQL ou Semgrep, varredura de segredos, revisão de migração e Dependabot/Renovate. Fixar permissões dos workflows e ações por SHA.

### MÉDIO-06 — O schema completo não é reproduzível apenas por supabase/migrations

Evidências:

- a definição de delete_user aparece em docs/supabase-migration.sql:82-90;
- supabase/migrations/20260730_secure_subscriptions.sql:270-277 apenas altera a função “caso ela já exista”;
- outras migrações assumem objetos de um baseline anterior.

**Impacto:** um ambiente novo ou restauração pode ficar com objetos ausentes ou definições diferentes de produção. Isso dificulta auditoria, disaster recovery e comprovação de que RLS/grants são idênticos.

**Correção:** gerar uma migração baseline imutável e verificável, manter somente migrações em supabase/migrations e comparar periodicamente schema remoto com o repositório.

## Achados baixos

### BAIXO-01 — A varredura interna de segurança não cobria o site nem o histórico Git

**Estado:** cobertura do site corrigida nesta rodada; varredura do histórico continua pendente.

Evidências:

- antes da correção, scripts/security-check.cjs:8-13 omitira web;
- agora o verificador inclui web e ignora somente artefatos gerados como web/.next e dependências;
- a execução manual não encontrou segredo real nos arquivos versionados;
- git ls-files encontrou apenas .env.example e web/.env.local.example como arquivos de ambiente.

**Impacto:** uma futura chave hardcoded no site pode passar pelo comando oficial. Uma chave removida do estado atual também pode continuar no histórico Git.

**Correção restante:** o site e seus manifests já estão cobertos pelo comando local. Adicionar gitleaks/trufflehog no histórico, CI e proteção de push. Nunca imprimir o valor encontrado nos logs.

### BAIXO-02 — Logs do aplicativo podem registrar detalhes excessivos

Evidências:

- app/_layout.tsx:126-130 registra erro e componentStack;
- app/(tabs)/index.tsx:1445-1449 registra code, message e details de erro do Supabase;
- app/(tabs)/transacoes.tsx:362 e app/(tabs)/transacoes.tsx:1101 registram objetos de erro;
- app/(tabs)/caixinhas.tsx:298 registra erro bruto.

**Impacto:** logs locais, ADB ou uma futura plataforma de crash reporting podem receber nomes de tabela, detalhes de validação ou identificadores. Nenhum segredo hardcoded foi encontrado.

**Correção:** logar códigos normalizados, aplicar redação, desativar detalhes em produção e proibir dados financeiros/PII em telemetria.

### BAIXO-03 — Notificação web pode revelar informação financeira na tela bloqueada

Evidências:

- web/src/components/notifications/financial-notification-scheduler.tsx:170-177 envia título e corpo do evento;
- web/public/sw.js:39-44 exibe o corpo recebido;
- web/public/sw.js:8-16 restringe corretamente a rota de clique à allowlist.

**Impacto:** dependendo do navegador/sistema operacional, valores e descrições podem aparecer na tela bloqueada. É risco de privacidade local, não quebra de autenticação.

**Correção:** usar texto genérico por padrão, permitir detalhes somente com opt-in explícito e mostrar o conteúdo completo após abrir o FinFlow autenticado.

## GitHub Pages

**Conclusão:** o site completo não deve ser hospedado no GitHub Pages no estado atual.

Motivos:

- web/src/lib/supabase/proxy.ts:33-77 depende de execução no servidor para renovar cookies e proteger rotas;
- web/src/app/(dashboard)/contas/actions.ts:1, objetivos/actions.ts:1, cartoes/actions.ts:1 e outras usam Server Actions;
- web/src/lib/supabase/server.ts:1-9 usa cookies no servidor;
- web/src/app/auth/callback/route.ts é uma rota de servidor;
- web/next.config.ts:10-39 define cabeçalhos por resposta;
- web/package.json oferece next build/next start, não export estático.

GitHub Pages serve arquivos estáticos: não executa proxy, route handlers ou Server Actions e não aplica de forma confiável os cabeçalhos definidos pelo Next. Forçar export quebraria autenticação/operações e reduziria CSP/HSTS. Pages pode servir somente conteúdo estático separado, como documentação ou páginas legais. Para o produto, usar Vercel, Cloudflare com runtime Next compatível ou servidor Node.

## Controles validados

Os seguintes controles foram encontrados e devem ser preservados:

- nenhum segredo real foi encontrado em arquivos versionados; somente exemplos de ambiente;
- .gitignore:17-25 e .gitignore:39-43 cobre keystores, chaves, credenciais e .env;
- chaves EXPO_PUBLIC/NEXT_PUBLIC do Supabase são anon/publishable por desenho; sua segurança depende de RLS, não de sigilo;
- lib/offline-queue.ts:83-160 mantém conteúdo financeiro no SecureStore e usa AsyncStorage apenas para UUIDs opacos; sem módulo nativo, a fila fica em memória;
- app.json:20 desabilita backup Android;
- proteção contra captura de tela e proteção do app switcher estão em app/_layout.tsx;
- bloqueio por inatividade e limpeza de notificações no logout estão implementados;
- web/src/lib/supabase/proxy.ts:62 usa auth.getUser(), não apenas sessão não verificada;
- origem de autenticação e redirects de checkout são allowlists, não Origin arbitrário;
- web/public/sw.js:27-37 armazena apenas assets estáticos, nunca HTML autenticado/dados financeiros;
- supabase/functions/_shared/http.ts:14-69 rejeita origem web fora da allowlist e não usa wildcard;
- supabase/functions/_shared/http.ts:98-164 limita tamanho, tipo e campos dos JSONs;
- o webhook valida HMAC e consulta o estado oficial no Mercado Pago;
- Edge Functions autenticadas mantêm verify_jwt, enquanto webhook e hook SMS públicos possuem validação própria;
- funções SECURITY DEFINER revisadas usam search_path restrito; triggers não são executáveis diretamente;
- tabelas financeiras revogam anon e habilitam RLS nas migrações revisadas;
- não foram encontradas APIs de HTML bruto/execução dinâmica nem endpoints externos HTTP no produto;
- testes de segurança, IA, idempotência e fila offline passaram.

## Plano de correção

### P0 — Antes da próxima expansão de usuários

- ALTO-01: aplicar migração de compartilhamento após auditoria dos dados;
- ALTO-02: PKCE + App/Universal Links;
- ALTO-03: exclusão com step-up no servidor;
- ALTO-04: RPC atômica para objetivo e bloqueio de UPDATE direto;
- ALTO-05: novo binário mínimo com SecureStore.

### P1 — Próxima versão de segurança

- validar timestamp do webhook;
- reduzir CSP unsafe-inline;
- configurar assinatura EAS Update;
- mitigar image-size no pipeline;
- consolidar baseline do banco.

### P2 — Processo contínuo

- CI/SAST/Dependabot/secret scanning;
- logs redigidos;
- notificações web privadas;
- MobSF em APK/AAB/IPA e DAST somente em ambiente de laboratório.

## Limitações

- A auditoria não executou ataque, SQL mutável ou replay contra produção.
- Não houve dump integral de pg_catalog/policies do banco remoto; o estado foi inferido pelas migrações e pela lista vinculada. Antes de fechar os altos de banco, comparar as definições remotas.
- Não foram executados Burp Suite, OWASP ZAP, MobSF, jailbreak/root ou análise do APK final nesta sessão.
- Não foram auditadas configurações administrativas externas como MFA dos responsáveis, branch protection, regras da organização Expo, retenção de logs Supabase ou políticas do Mercado Pago.
- npm audit é uma fotografia do registry e retornou zero, mas não detectou os dois avisos atuais de image-size; por isso a revisão manual deve continuar.
- O audit online reporta 10 nós altos derivados de image-size; a classificação deste relatório permanece média porque o caminho comprovado é o pipeline de build, não entrada remota no aplicativo instalado.
- Ausência de achado não equivale a garantia absoluta de segurança.

## Critério de encerramento

Um achado só deve ser marcado como corrigido quando existir:

1. alteração versionada;
2. teste automatizado ou prova negativa;
3. implantação confirmada no ambiente correto;
4. verificação pós-implantação sem acesso cruzado, perda de dados ou regressão de login.
