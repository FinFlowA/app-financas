# Rotas e telas

## Aplicativo Expo

| Rota | Função |
|---|---|
| `/login` | Login, cadastro e entrada nos fluxos de autenticação |
| `/auth/callback` | Processamento de links PKCE |
| `/define-password` | Definição inicial de senha |
| `/reset-password` | Recuperação de senha |
| `/email-confirmed` | Confirmação de e-mail |
| `/(tabs)` | Página inicial e atalhos financeiros |
| `/(tabs)/transacoes` | Histórico, criação, edição e conclusão |
| `/(tabs)/caixinhas` | Objetivos financeiros |
| `/(tabs)/cartoes` | Cartões, compras e faturas |
| `/(tabs)/relatorios` | Fluxo e relatórios do aplicativo |
| `/(tabs)/configuracoes` | Perfil, preferências, parceria, plano e conta |
| `/chat-ia` | Assistente Finn |
| `/planos` | Apresentação de planos; cobrança mobile real ainda não integrada |
| `/seguranca` | Configurações e informações de segurança |
| `/flow-screen` | Hospedagem interna de modais/telas sobrepostas navegáveis |

`flow-screen` é infraestrutura interna. Ao sair de uma sobreposição para outra aba, substitua a rota intermediária para não deixar uma tela órfã na pilha.

## Site Next.js

### Públicas/autenticação

| Rota | Função |
|---|---|
| `/login` | Login |
| `/cadastro` | Cadastro |
| `/esqueci-senha` | Solicitação de recuperação |
| `/redefinir-senha` | Nova senha |
| `/definir-senha` | Definição inicial |
| `/auth/callback` | Callback Supabase |
| `/auth/oauth` | Início OAuth |
| `/privacidade` | Política de privacidade |
| `/termos` | Termos de uso |

### Painel autenticado

| Rota | Função |
|---|---|
| `/` | Dashboard, saldos, gráficos, alertas e atalhos |
| `/transacoes` | Lançamentos, filtros, baixa e reabertura |
| `/contas` | Contas e compartilhamento |
| `/objetivos` | Objetivos |
| `/cartoes` | Lista de cartões |
| `/cartoes/[id]` | Fatura, compras, pagamento e estorno |
| `/categorias` | Categorias e arquivamento |
| `/relatorios` | Fluxo mensal/diário e seleção de contas |
| `/calendario` | Agenda financeira |
| `/conciliacao` | Importação CSV/OFX e conciliação |
| `/assistente` | Finn no site |
| `/planos` | Preços Paddle, checkout e portal |
| `/welcome` | Retorno informativo após checkout |
| `/configuracoes` | Perfil e preferências |
| `/seguranca` | Segurança da conta |

### API

| Método e rota | Função |
|---|---|
| `POST /api/paddle/webhook` | Recebe corpo bruto, verifica assinatura e provisiona assinatura |

O Proxy/Middleware deve manter a rota do webhook fora do redirecionamento de login.

## Onde adicionar funcionalidade

- Nova tela mobile: arquivo em `app/` e, se necessário, entrada no layout da aba.
- Nova página web: pasta em `web/src/app/`; dados sensíveis permanecem server-side.
- Regra financeira compartilhada: domínio em `lib/` e equivalente em `web/src/lib/`, com testes.
- Escrita composta: migration/RPC antes do cliente.
- Integração externa: adaptador server-only, variáveis documentadas e teste de falha.

