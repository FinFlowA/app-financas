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

