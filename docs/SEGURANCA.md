# Segurança

## Fronteiras de confiança

- Navegador e aplicativo são ambientes não confiáveis.
- URL Supabase, chave `anon`, client token Paddle e IDs de preço são publicáveis, não autorizadores.
- `service_role`, API key Paddle, webhook secret, chaves de IA, Brevo e conexão PostgreSQL são secretos.
- Banco/RPCs e rotas server-side são responsáveis pela autorização final.

## Controles existentes

- Supabase Auth e `auth.uid()`.
- RLS nas tabelas financeiras e de assinatura.
- RPCs transacionais, idempotentes e com locks ordenados.
- Controle otimista por `version`.
- Corpo bruto e assinatura do webhook Paddle.
- CSP no site, incluindo origens necessárias do Paddle.
- PKCE nos fluxos de autenticação.
- Troca/redefinição de senha encerra as demais sessões no próprio Supabase Auth (`LogoutAllExceptMe`); o JWT de acesso já emitido vale até expirar.
- Senha vazada: cadastro, definição e troca de senha consultam o HaveIBeenPwned por k-anonymity (`lib/pwned-password.ts` no app, `web/src/lib/auth/pwned-password.ts` no site). Só os 5 primeiros caracteres do SHA-1 saem; se a API cair, o fluxo segue. Substitui a proteção nativa da Supabase, que exige plano Pro.
- SecureStore e bloqueio biométrico local.
- Retenção de mensagens da IA e metadados allowlisted.
- Gitleaks no histórico completo e verificação própria `security-check.cjs`.

## Regras obrigatórias

- Nunca usar `service_role` no cliente.
- Nunca confiar em `user_id`, customer ID, status de plano ou preço enviados pelo cliente.
- Nunca fazer `JSON.parse` antes da verificação do webhook.
- Nunca conceder plano pelo redirect do checkout.
- Nunca executar texto produzido pelo modelo sem normalização, confirmação e RPC.
- Nunca remover RLS para corrigir erro de permissão.
- Nunca registrar senha, token, corpo integral de webhook ou dados bancários crus.

## Verificação em duas etapas (MFA)

Opcional, por app autenticador (TOTP, gratuito no Supabase). SMS não é usado: é add-on pago e vulnerável a clonagem de chip.

- **Onde é exigida:** no servidor. `finflow_guard.enforce_mfa()` roda como `pgrst.db_pre_request` antes de toda requisição do PostgREST (tabelas, RPCs e GraphQL) e recusa com `FINFLOW_MFA_REQUIRED` (42501) quem tem fator verificado e sessão sem o código (AAL1). Isso cobre as funções SECURITY DEFINER, que ignoram RLS. O Realtime não é usado.
- **service_role:** não passa pelo pre-request. Por isso as Edge Functions (`_shared/supabase.ts` → `mfaSatisfied`, Finn → `AI_MFA_REQUIRED`) e o portal Paddle do site checam por conta própria antes de agir pelo usuário.
- **Supabase Auth** já exige AAL2 para trocar senha/e-mail e para adicionar/remover fator quando há MFA ativo, e desconecta as sessões AAL1 ao ativar.
- **Site:** o proxy leva quem está pendente para `/verificacao-duas-etapas`. Em Segurança: ativar (QR, abrir no app, copiar chave), autenticador reserva (máx. 2) e remover. Desbloqueio da área e exclusão de conta pedem senha **e** código.
- **App:** o `_layout` retém a sessão pendente (o app age como deslogado e mostra `MfaChallengeScreen`). Telas que reautenticam com senha sinalizam `definirReautenticacao` para pedir o código na própria tela; ao desistir, a sessão é reavaliada. A fila offline trata `FINFLOW_MFA_REQUIRED` como erro temporário (`OFFLINE_MFA_REQUIRED`).
- **Reverter em emergência** (derruba só a exigência no banco): `alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';`

### Recuperação (usuário perdeu o autenticador)

Não há códigos de recuperação nativos na versão atual do Supabase Auth (chegam na 2.198). Até lá:

1. Confirme a identidade antes de qualquer ação: e-mail de cadastro respondendo do próprio endereço e dados que só o titular sabe (ex.: contas e valores recentes). Na dúvida, não remova.
2. No painel do Supabase, em *Authentication → Users*, localize o usuário pelo e-mail e anote o ID.
3. Remova os fatores pela API admin, com a chave `service_role` (nunca em cliente):
   `DELETE {SUPABASE_URL}/auth/v1/admin/users/{user_id}/factors/{factor_id}` (liste com `GET .../admin/users/{user_id}/factors`).
4. Oriente a pessoa a entrar e ativar a verificação de novo, de preferência com um autenticador reserva.
5. Registre o atendimento (data, quem aprovou, como a identidade foi confirmada), sem copiar dados sensíveis.

## Tetos de segurança por usuário (anti-abuso)

Os limites de plano (Free/Smart) podem ficar desligados (`billing_settings.limits_enabled=false`). Os tetos de segurança não dependem disso: valem sempre, em qualquer plano, inclusive Premium, e impedem que uma conta sozinha, ou um script usando a API, encha o banco. Foram aprovados em 30/09/2026 com base no uso real, de 10 a 40 vezes acima do maior usuário.

| Recurso (`private.tetos_antiabuso`) | Tabela | Teto total | Teto por dia |
|---|---|---|---|
| `lancamentos` | `transacoes` | 50.000 | 5.000 |
| `compras_cartao` | `fatura_itens` | 20.000 | 3.000 |
| `contas` | `contas` (inclui arquivadas) | 100 | — |
| `objetivos` | `caixinhas` (inclui arquivados) | 100 | — |
| `cartoes` | `cartoes` | 50 | — |
| `categorias` | `categorias` (inclui inativas) | 300 | — |
| `convites_parceria` | `parcerias` (quem convida) | — | 10 |
| `feedbacks` | `feedbacks` | — | 10 |
| `historico_finn` | `chat_historico` (legado) | 2.000 | 300 |

- **Onde é aplicado:** gatilho `finflow_teto_antiabuso` (AFTER INSERT por comando) em cada tabela, com `private.aplicar_teto_antiabuso`. Um lote (série recorrente, parcelas) conta todas as linhas de uma vez. O dia segue o horário de Brasília e o contador fica em `private.criacoes_diarias` (limpo após 7 dias pela tarefa `finflow-cleanup-anti-abuse-counters`).
- **Quem fica de fora:** `service_role` (Edge Functions, que têm limites próprios) e manutenção sem JWT (migrations, SQL editor, restauração de backup). As ações do Finn rodam com o login do usuário e contam normalmente.
- **Recusa:** `P0001` com a mensagem `FINFLOW_TETO_SEGURANCA:<recurso>:<diario|total>:<teto>`. O app (`lib/teto-seguranca.ts`) e o site (`mensagemTetoSeguranca` em `web/src/lib/error-messages.ts`) mostram "Você atingiu o limite de segurança de …" com o e-mail do suporte; o Finn recebe `AI_SAFETY_LIMIT_REACHED`. Não é limite de plano: a mensagem não oferece upgrade.
- **Tamanho dos textos:** CHECKs `<tabela>_<coluna>_tamanho` limitam descrição de lançamento (500), nomes (150), cor (32), ícone (64), feedback (5.000), e-mail do convite (254) e histórico do Finn (4.000), acima do que as telas aceitam.
- **Suporte — usuário legítimo esbarrou no teto:** confira o uso com `select * from private.criacoes_diarias where user_id = '<id>' order by dia desc;` e, se fizer sentido, aumente o número para todos numa migration (`update private.tetos_antiabuso set ... where recurso = '...'`). Em urgência, o mesmo UPDATE pode ser aplicado direto e registrado depois numa migration. Os Termos de Uso (seção 4) avisam que recursos ilimitados têm limites técnicos de segurança.

## CORS das Edge Functions

- Só origens de `FINFLOW_ALLOWED_ORIGINS` são aceitas no navegador; apps nativos não enviam `Origin`.
- Origens `localhost` só valem com a função rodando no Supabase local ou com o secret `FINFLOW_ALLOW_LOCALHOST_ORIGINS=true`, ligado de propósito para testar o site local contra produção. Desligue depois do teste: `supabase secrets unset FINFLOW_ALLOW_LOCALHOST_ORIGINS`.

## Push remoto

- O token de push fica em `dispositivos_push`, no máximo 10 por conta.
- `registrar_dispositivo_push` só transfere um token de uma conta para outra quando o pedido traz o segredo da mesma instalação do app (gerado no aparelho, guardado no SecureStore; o banco guarda só o SHA-256). Quem sabe apenas o token não consegue desviar os avisos de outra pessoa.

## Compartilhamento

- A parceria aceita é necessária, mas não suficiente: o recurso precisa estar marcado como compartilhado.
- A dissolução preserva o histórico e exige decisões seguras para recursos conjuntos.
- Um parceiro não assume propriedade do recurso.
- Alterações críticas revalidam acesso dentro da mesma transação.

## Exclusão de conta

- Requer sessão válida e autenticação recente.
- Deve falhar se houver parceria, convite, dissolução ou assinatura que impeça exclusão segura.
- A RPC executa a ordem correta de remoção e preserva dados pertencentes ao outro usuário.
- A interface deve explicar irreversibilidade antes de solicitar a confirmação.

## Gitleaks

O CI varre todo o histórico. `.gitleaksignore` aceita somente fingerprints revisados de credenciais deliberadamente públicas, como chave Supabase `anon` ou token client-side Paddle. Não adicione padrão amplo nem ignore um secret real.

Se um secret for encontrado:

1. revogue/rotacione primeiro;
2. determine impacto e período de exposição;
3. remova o uso do código atual;
4. trate o histórico conforme necessidade;
5. atualize ambientes e redeploy;
6. registre o incidente sem copiar o valor.

## Dependências

`npm audit` é informativo no CI; severidade precisa ser analisada pelo caminho de exploração real. Atualizações principais de Expo/Next devem ser feitas em entrega própria com testes, não aplicadas automaticamente em correção funcional.

## Revisões relacionadas

Auditorias antigas em `docs/security/` são evidências históricas, não garantia do estado atual. Revalide recomendações contra a `main`.

A mais recente é a [reauditoria de 30/09/2026](./security/REAUDITORIA_2026-09-30.md), que valida as correções da auditoria de setembro, inclusive as configurações do Auth hospedado.

