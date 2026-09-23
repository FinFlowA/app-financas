# Ambientes e variáveis

## Ambientes usados

| Ambiente | Uso |
|---|---|
| Local mobile | Expo local ou development build |
| Local web | Next.js em `http://localhost:3100` |
| Preview web | branch/deployment de validação na Vercel |
| Produção web | domínio aprovado e variáveis live |
| Supabase | backend compartilhado; confirme o projeto antes de migrations |
| Paddle sandbox | checkout sem cobrança real |
| Paddle live | cobrança real após verificação e aprovação de domínio |
| EAS preview | APK interno e OTA de validação |
| EAS production | build/canal destinado à loja |

Nunca misture IDs de preço, client token, API key ou webhook secret entre Paddle sandbox e live.

## Aplicativo Expo

Arquivo local: `.env.local`, criado a partir de `.env.example`.

| Variável | Exposição | Finalidade |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Pública | URL do projeto Supabase |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Pública | Chave publicável protegida por RLS |
| `EXPO_PUBLIC_FINFLOW_LOCAL_DEMO` | Pública | Ativa dados fictícios somente em revisão local |

O prefixo `EXPO_PUBLIC_` coloca o valor no bundle. Nunca o use para secrets.

## Site Next.js

Arquivo local: `web/.env.local`, criado a partir de `web/.env.local.example`. Na Vercel, configure valores separados para Development, Preview e Production.

| Variável | Exposição | Finalidade |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Pública | URL do Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Pública | Chave publicável do Supabase |
| `NEXT_PUBLIC_SITE_URL` | Pública | Origem canônica do site |
| `NEXT_PUBLIC_PADDLE_ENV` | Pública | `sandbox` ou `production` |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | Pública | Token client-side Paddle correspondente ao ambiente |
| `NEXT_PUBLIC_PADDLE_SMART_MONTHLY_PRICE_ID` | Pública | Preço mensal Pro |
| `NEXT_PUBLIC_PADDLE_SMART_YEARLY_PRICE_ID` | Pública | Preço anual Pro |
| `NEXT_PUBLIC_PADDLE_PREMIUM_MONTHLY_PRICE_ID` | Pública | Preço mensal Plus |
| `NEXT_PUBLIC_PADDLE_PREMIUM_YEARLY_PRICE_ID` | Pública | Preço anual Plus |
| `PADDLE_API_KEY` | Secreta | SDK Paddle no servidor e portal |
| `PADDLE_NOTIFICATION_WEBHOOK_SECRET` | Secreta | Verificação das entregas do webhook |
| `SUPABASE_SERVICE_ROLE_KEY` | Secreta | Escrita administrativa após webhook verificado |

IDs internos mantêm os nomes históricos `smart` e `premium`; a interface mostra Pro e Plus.

## Supabase Edge Functions

Secrets são configurados no Supabase, nunca em `.env` versionado:

| Grupo | Variáveis |
|---|---|
| CORS | `FINFLOW_ALLOWED_ORIGINS` |
| SMS | `SEND_SMS_HOOK_SECRET`, `BREVO_API_KEY`, `BREVO_SMS_SENDER` |
| IA | `FINFLOW_AI_PROVIDER`, `FINFLOW_AI_ROLLOUT_MODE`, `FINFLOW_AI_ALLOWED_EMAILS`, `FINFLOW_AI_REQUESTS_PER_MINUTE` |
| Groq | `GROQ_API_KEY`, `FINFLOW_GROQ_MODEL`, `FINFLOW_GROQ_REASONING_EFFORT` |
| OpenAI | `OPENAI_API_KEY`, `FINFLOW_OPENAI_MODEL`, `FINFLOW_OPENAI_REASONING_EFFORT` |
| Legado Mercado Pago | `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET`, `FINFLOW_BILLING_RETURN_URL` |

As funções Mercado Pago ainda existem no repositório por compatibilidade histórica, mas o checkout web atual usa Paddle. Não configure ou reative o legado sem uma decisão de migração explícita.

## GitHub Actions

| Secret | Workflow |
|---|---|
| `EXPO_TOKEN` | Publicação EAS Update após CI |
| `SUPABASE_DB_URL` | Backup diário do PostgreSQL |

## Regras de manuseio

- Não envie valores secretos por commit, issue, documentação ou captura de tela.
- Variáveis públicas não autorizam o banco sozinhas; RLS continua obrigatória.
- Após trocar uma variável na Vercel, gere novo deployment.
- Após trocar variável `EXPO_PUBLIC_*`, publique OTA compatível ou gere novo build quando houver mudança nativa/runtime.
- Rotacione imediatamente uma credencial secreta exposta e depois trate o histórico.

