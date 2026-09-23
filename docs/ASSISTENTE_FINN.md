# Assistente Finn

## Objetivo

O Finn responde a perguntas financeiras e prepara ações sobre os dados do usuário. Ele não deve atuar fora do domínio financeiro nem escrever diretamente no banco a partir do modelo.

## Fluxo seguro

```text
Mensagem autenticada
  → Edge Function finance-ai
  → contexto agregado autorizado
  → provedor OpenAI ou Groq
  → resposta ou ação pendente
  → confirmação explícita do usuário
  → RPC financeira validada
  → auditoria/recibo
```

## Componentes

- `app/chat-ia.tsx`: experiência mobile.
- `web/src/app/(dashboard)/assistente/`: experiência web.
- `supabase/functions/finance-ai/`: orquestração server-side.
- `shared/finance-ai-contract.ts`: contrato compartilhado.
- `lib/finance-ai/` e `web/src/lib/finance-action.ts`: tipos e adaptação dos clientes.
- migrations `20260802000100` e posteriores: contexto, cotas, auditoria, retenção e execução.

## Autoridade e confirmação

- O modelo pode sugerir ou preparar uma ação.
- A ação preparada recebe identificador, expiração e payload normalizado.
- O usuário deve revisar e confirmar explicitamente.
- A RPC revalida autenticação, propriedade, estado, limites e dados; o texto do modelo não é autorização.
- Ações repetidas usam idempotência para evitar duplicação.

## Provedores

`FINFLOW_AI_PROVIDER` escolhe `openai` ou `groq`. Chaves e modelos ficam somente nos secrets da Edge Function. O cliente não chama o provedor diretamente.

## Liberação e cotas

- `FINFLOW_AI_ROLLOUT_MODE`: `off`, `beta` ou `plans`.
- `FINFLOW_AI_ALLOWED_EMAILS`: allowlist para rollout controlado.
- `FINFLOW_AI_REQUESTS_PER_MINUTE`: limite técnico.
- A matriz comercial define consultas e ações diárias por plano.
- O servidor é responsável por reservar e finalizar o consumo.

## Privacidade e retenção

- Envie ao provedor apenas o contexto necessário.
- Não inclua secrets, tokens, senha ou dumps integrais.
- Conversas e mensagens estão sujeitas à rotina de retenção; a migration atual define retenção curta de 24 horas para mensagens.
- Auditoria de ação financeira deve preservar metadados necessários sem armazenar raciocínio interno do modelo.

## Alterações coordenadas

Mudanças de intents, payloads ou ações exigem atualização conjunta de:

1. contrato compartilhado;
2. parser/orquestrador da Edge Function;
3. validação e RPC;
4. clientes mobile e web;
5. testes `finance-ai`, contexto, state guard e edge security.

Evite editar a área da IA em paralelo sem combinar arquivos e contratos com o responsável pela frente.

