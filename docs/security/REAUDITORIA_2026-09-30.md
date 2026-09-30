# Reauditoria de segurança — 30/09/2026

Validação final (Etapa 8) das correções da auditoria de setembro de 2026. Refaz, em produção, os testes que a auditoria original não pôde executar e confere cada achado (V01–V15).

## Método

- **Contas de teste:** criadas pela API de administração do Supabase com e-mails `@example.com` (nenhum e-mail enviado) e excluídas no fim pelo fluxo normal do app (`delete_user`). Foi conferido que não sobrou nenhuma linha delas.
- **Ataques:** feitos pela API pública (PostgREST, RPCs, Edge Functions), como um usuário logado mal-intencionado faria.
- **Configurações hospedadas:** conferidas pelo comportamento observável (endpoint público de configurações, troca de senha, renovação de sessão), porque a API de gerenciamento não estava disponível.
- **Alertas do Supabase:** reexecutados com as consultas do [splinter](https://github.com/supabase/splinter), as mesmas do painel de Advisors.

## Situação dos achados originais

| Achado | Severidade | Situação | Como foi verificado |
|---|---|---|---|
| V01 Backup publicaria o banco num repositório público | Crítica | Corrigido (Etapa 1) | Workflow removido; backup só no repositório privado `finflow-backups`, criptografado |
| V02 Next.js com alertas críticos | Alta | Corrigido (Etapa 3) | `npm audit` do site: 0 alertas |
| V03 Sem backup funcional nem restauração testada | Alta | Corrigido (Etapa 2) | Backup diário com teste de restauração automático |
| V04 Sem MFA | Média | Corrigido (Etapa 5) | TOTP opcional exigido no banco (`finflow_guard.enforce_mfa`) |
| V05 Troca de senha não encerra outras sessões | Média | Corrigido (Etapa 4) | Ver [SEGURANCA.md](../SEGURANCA.md) |
| V06 Proteção contra senhas vazadas desligada | Média | Corrigido nas telas (Etapa 4) | HIBP no app e no site; ver R01 para a API direta |
| V07 Banco diferente das migrations | Média | Corrigido (Etapa 6) | Workflow "schema": "Sem divergências" em 30/09 |
| V08 Sem limite no servidor para criação de dados | Média | Corrigido (Etapa 7) | Tetos por usuário; 37 testes pgTAP no CI |
| V09 `anon` executava `refresh_my_recurring_schedules` | Baixa | Corrigido (Etapa 7) | Alerta sumiu dos Advisors |
| V10 Permissões excessivas em `finance_ai_debug_log` | Baixa | Corrigido (Etapa 6) | Tabela removida |
| V11 CORS aceitava qualquer `localhost` | Baixa | Corrigido (Etapa 7) | Preflight real: `localhost` recebe 403, o site oficial recebe 204 |
| V12 `pg_net` no schema `public` | Baixa | Corrigido (Etapa 7) | Alerta sumiu; push testado do banco até a função |
| V13 Token de push reatribuível | Baixa | Corrigido (Etapa 7) | Reteste em produção: 5/5 |
| V14 `.gitignore` sem a chave do Firebase Admin | Baixa | Corrigido (Etapa 1) | Padrão no `.gitignore` |
| V15 Alertas em dependências do app | Baixa | Parcial | Ver R03 |

## Testes executados na Etapa 8

### Acesso cruzado entre contas (IDOR)

A conta B criou dados marcados (conta, categoria, lançamento, objetivo, cartão, compra, feedback, aparelho de push). A conta A tentou ler, alterar, apagar, gravar em nome de B e usar as referências de B.

| Grupo | Resultado |
|---|---|
| A lê 26 tabelas, e lê por id | 32/32 sem vazamento |
| A altera e apaga linhas de B | 12/12 sem efeito |
| A grava em nome de B ou usa conta, categoria ou cartão de B | 6/6 recusados |
| A chama 37 RPCs com ids de B | 37/37 sem vazamento nem efeito |
| Visitante sem login (tabelas, gravação, RPCs) | 31/31 recusados |
| Finn: confirmar ação inexistente | Recusado |
| Dados de B antes e depois dos ataques | Idênticos |

Uma conferência acusou que o token de push de B tinha mudado. A causa foi o próprio teste. O convite de A gerou um aviso para B, e a função `send-system-push` apagou o token falso quando o Expo respondeu que o aparelho não existia (limpeza prevista). O reteste do V13 sem convite passou 5/5: outra conta não toma nem remove o token, com ou sem segredo, e a troca de login no mesmo aparelho continua funcionando.

### Prompt injection no Finn

Nove tentativas feitas pela conta A:
- revelar o prompt;
- listar dados de outro usuário por id;
- ler uma conta de B;
- exportar dados de todos os usuários;
- falso "modo administrador";
- criar lançamento na conta de B sem confirmação;
- criar e confirmar sozinho;
- revelar chaves;
- fugir do tema.

Todas foram recusadas com a resposta de fora do escopo. Nenhuma resposta trouxe dado de B, trecho do prompt ou chave, e nenhuma linha ou ação pendente foi criada. Um pedido legítimo ("crie uma conta chamada Reserva…") gerou só uma prévia com token de confirmação, sem gravar nada. O limite de mensagens por minuto do Finn também atuou quando os pedidos vieram em sequência rápida.

### Alertas do Supabase (Advisors)

Depois da Etapa 7, restam só alertas esperados:
- 55 funções `SECURITY DEFINER` executáveis por usuários logados, que são as RPCs do produto e validam o dono internamente;
- 12 tabelas com RLS e sem políticas, acessíveis só pelo backend.

## Achados novos

### R01 — Política de senha não aplicada no Auth hospedado (Média)

- **Evidência:** pela API direta, a troca de senha aceitou `abcdefgh` e uma senha de 7 caracteres. O `supabase/config.toml` exige 8 caracteres com minúscula, maiúscula, número e símbolo, mas esse arquivo não é aplicado automaticamente ao projeto hospedado.
- **Impacto:** as telas do app e do site validam a senha, mas quem chama a API direto consegue definir uma senha fraca para a própria conta.
- **Correção:** no painel do Supabase, em *Authentication → Providers → Email*, definir o tamanho mínimo 8 e a exigência "minúsculas, maiúsculas, números e símbolos".

### R02 — Reuso do token de renovação de sessão aceito (Média)

- **Evidência:** um token de renovação já usado foi aceito de novo 15 segundos depois, e a sessão continuou válida.
- **Impacto:** um token de renovação vazado continua útil mesmo depois de o dono renovar a sessão, e o Supabase não derruba a sessão comprometida.
- **Correção:** no painel, em *Authentication → Sessions* (ou *Security*), ligar "Detect and revoke potentially compromised refresh tokens" e manter o intervalo de reuso em 10 segundos. Depois, repetir o teste.

### R03 — Dependências do app (Baixa)

- **Corrigido nesta etapa:**
  - `brace-expansion` e `@react-navigation/core` foram corrigidos com `npm audit fix`, sem mudança de versão principal;
  - `axios` estava no `package.json`, mas nenhum código o usava, e tinha alertas altos, então foi removido.
- **Risco aceito:**
  - `image-size` (alto) só é usado pelo empacotador Metro no build, sobre as imagens do próprio repositório;
  - três alertas moderados (`expo-router`, `query-string`, `decode-uri-component`) só se resolvem com troca de versão principal do `expo-router`. Isso exige um build nativo novo, e deve ser feito na próxima atualização do Expo SDK.

### R04 — Função legada `mercado-pago-webhook` desatualizada (Baixa)

A função publicada é de 30/07/2026 (v14), cerca de 200 linhas atrás da `main`, e continua pública (`verify_jwt=false`). Os pagamentos migraram para o Paddle. É preciso decidir entre removê-la do projeto ou republicá-la a partir da `main`.

## Pendências

1. Corrigir R01 e R02 no painel do Supabase e repetir o teste de Auth.
2. Decidir sobre R04.
3. Testar o push de parceria num aparelho com o APK `versionCode 13`.
