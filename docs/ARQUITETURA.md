# Arquitetura do FinFlow

## Visão geral

O FinFlow possui dois clientes que compartilham autenticação, dados e regras financeiras:

- aplicativo Expo/React Native, em `app/`, `components/` e `lib/`;
- site Next.js, em `web/`;
- backend Supabase, com Auth, PostgreSQL, RLS, RPCs e Edge Functions;
- Paddle para checkout e gestão de assinaturas do site;
- EAS Build/Update para distribuição do aplicativo.

```text
App Expo ───────────────┐
                       ├── Supabase Auth ── RLS/RPCs ── PostgreSQL
Site Next.js ───────────┘        │                     │
       │                         ├── finance-ai        ├── dados financeiros
       ├── Paddle.js checkout    └── outras Edge       └── assinaturas espelhadas
       ├── API webhook Paddle
       └── Server Actions/SSR
```

## Responsabilidades por camada

### Aplicativo

- Expo Router controla as telas e abas.
- O cliente Supabase usa apenas URL e chave pública `anon`.
- Escritas simples respeitam RLS; ações compostas usam RPCs idempotentes.
- SQLite mantém fila offline e recibos locais; SecureStore protege material de sessão; AsyncStorage guarda preferências e cache não sensível.
- Biometria protege o acesso local, mas não substitui autorização no servidor.
- O app não deve receber `service_role`, chaves de IA ou secrets de cobrança.

### Site

- Next.js App Router com Server Components, Server Actions e Proxy/Middleware.
- `@supabase/ssr` mantém a sessão em cookies.
- O navegador recebe somente variáveis `NEXT_PUBLIC_*`.
- Operações administrativas do webhook usam o cliente Supabase server-only com `SUPABASE_SERVICE_ROLE_KEY`.
- Paddle.js apresenta preços e checkout; o SDK Node verifica webhooks e cria sessões do portal.

### Supabase

- Auth é a identidade canônica.
- PostgreSQL é a fonte de verdade financeira e de direitos de acesso.
- RLS limita leitura e escrita ao proprietário ou parceiro autorizado.
- RPCs `security definer` validam identidade, propriedade, estado, versão e idempotência antes de ações compostas.
- Migrations em `supabase/migrations/` são ordenadas pelo prefixo temporal e devem ser aplicadas na mesma ordem.

### Integrações externas

- Paddle: cobrança do site, portal, webhooks e sincronização da assinatura.
- OpenAI ou Groq: acessados somente pela Edge Function `finance-ai`.
- Brevo: envio do hook de SMS de autenticação, quando configurado.
- Expo/EAS: builds e atualizações OTA.
- Google Play Billing: integração futura para assinaturas digitais do app Android publicado na Play Store.

## Fluxos principais

### Autenticação

1. O usuário autentica no Supabase.
2. O app mantém a sessão no armazenamento seguro; o site usa cookies SSR.
3. RLS e RPCs usam `auth.uid()` como identidade.
4. Alterações sensíveis, como exclusão de conta, exigem reautenticação recente.

### Escrita financeira

1. A interface coleta e valida o formato básico.
2. Uma ação simples ou RPC recebe o usuário autenticado e uma chave idempotente.
3. O banco valida contas, categorias, compartilhamentos, limites e estado atual.
4. A transação grava todas as partes ou nenhuma.
5. O cliente atualiza a interface ou conserva a operação na fila offline.

### Assinatura web

1. `/planos` obtém preços localizados com Paddle PricePreview.
2. O navegador abre Paddle Checkout com o preço permitido e `finflow_user_id` em custom data.
3. O retorno para `/welcome` não concede acesso.
4. Paddle entrega evento assinado em `POST /api/paddle/webhook`.
5. O servidor verifica a assinatura sobre o corpo bruto.
6. O cliente administrativo vincula `paddle_customers` e faz upsert em `subscriptions`.
7. `get_my_entitlement()` e a matriz de planos determinam o acesso.

## Princípios de projeto

- Servidor como autoridade para dinheiro, direitos e exclusão.
- Idempotência em webhooks, ações offline e operações compostas.
- Histórico financeiro não é apagado como “limpeza”.
- Transferências e movimentos de objetivo não contam como receita/despesa.
- Falha fechada: inconsistências não produzem alterações parciais.
- App e site devem usar os mesmos conceitos, marcadores e limites.

