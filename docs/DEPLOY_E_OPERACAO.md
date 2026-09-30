# Deploy e operação

## Ordem segura de publicação

Quando uma entrega altera banco e clientes:

1. backup e verificação do ambiente;
2. migration compatível com clientes antigos;
3. Edge Functions/rotas server-side;
4. site em preview;
5. testes ponta a ponta;
6. site em produção;
7. OTA/build mobile;
8. monitoramento de erros e recibos.

Evite publicar um cliente que chame uma RPC ainda inexistente.

## Site na Vercel

- Root Directory: `web`.
- Build Command: `npm run build`.
- Runtime: Next.js completo; não use hospedagem puramente estática.
- Configure as variáveis de [Ambientes e variáveis](./AMBIENTES_E_VARIAVEIS.md) nos alvos corretos.
- Atualize `NEXT_PUBLIC_SITE_URL`, redirects do Supabase Auth e domínios Paddle.
- Mudança de variável exige novo deployment.

Validação de preview:

```bash
cd web
npm ci
npm run lint
npm test
npm run build
```

## Supabase

```bash
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
```

Revise o projeto vinculado antes do `db push`. Edge Functions alteradas devem ser publicadas explicitamente e receber somente os secrets necessários.

Após migrations financeiras, teste pelo menos criação, conclusão, reabertura, parcelamento, transferência, fatura e compartilhamento.

## Paddle

### Sandbox

- `NEXT_PUBLIC_PADDLE_ENV=sandbox`.
- Use catálogo, client token, API key e webhook secret sandbox.
- Teste checkout, webhook, portal, cancelamento e estados de falha.

### Live

- Crie catálogo e credenciais live próprios.
- Configure notification destination live para o webhook público.
- Aprove todos os domínios que abrem checkout.
- Configure default payment link com domínio real aprovado.
- Confirme termos, privacidade, cancelamento/reembolso e contato acessíveis.
- Teste localmente ou em staging; não exponha checkout live antes da aprovação.

Produtos, preços, destinations, customers, subscriptions e transactions são infraestrutura permanente.

## Aplicativo e EAS

| Perfil | Distribuição | Canal |
|---|---|---|
| `development` | Development build interno | `development` |
| `preview` | APK interno | `preview` |
| `production` | Loja | `production` |

```bash
npx eas-cli build --platform android --profile preview
npx eas-cli update --channel preview --message "descrição"
```

Alterações nativas, plugins, permissões, dependências nativas ou `runtimeVersion` exigem novo build. JavaScript compatível pode usar OTA.

O CI publica EAS Update no branch/canal de preview para o runtime atual e para o APK legado definido no workflow. O secret `EXPO_TOKEN` precisa existir.

## Backups

O backup do banco roda no repositório **privado** `FinFlowA/finflow-backups`,
nunca neste repositório (que é público). O antigo `db-backup.yml` daqui foi
removido: ele gravaria o dump sem criptografia num branch público.

Como funciona (detalhes e passo a passo de restauração no README do
`finflow-backups`):

- todo dia às 03:00 (America/Sao_Paulo), `supabase db dump` gera roles,
  schema e dados;
- cada dump é **restaurado num banco Supabase descartável** dentro do runner e
  só é aceito se as contagens das tabelas principais baterem com produção;
- depois é criptografado com `age` (a chave privada fica só com o
  responsável, fora do GitHub) e vira artefato apagado em 30 dias;
- o plano gratuito da Supabase não oferece backup restaurável pelo painel,
  então este é o único backup do projeto.

Verifique periodicamente:

- falhas do workflow (o GitHub avisa por e-mail);
- que a chave privada `age` continua acessível a mais de uma pessoa
  autorizada;
- rotação da senha do banco (atualizar o secret `SUPABASE_DB_URL` do
  `finflow-backups` ao trocar);
- que nenhum `*.dump` ou `backups/` entra neste repositório (o `.gitignore`
  já bloqueia).

## Schema do banco

O workflow **schema** do `finflow-backups` compara toda segunda-feira o banco de produção com o que as migrations do repositório recriam num banco vazio, e falha se houver diferença. Detalhes e processo de migration em `BANCO_DE_DADOS.md`.

## Rollback

- Código: reverta por novo commit; não reescreva a `main` compartilhada.
- Site: promova deployment anterior somente se compatível com o schema atual.
- OTA: publique atualização corretiva no mesmo runtime ou use rollback do EAS.
- Banco: prefira migration compensatória. Não apague migration aplicada.
- Cobrança: preserve eventos e entidades; desative entrada de novos checkouts somente por configuração planejada.

## Checklist pós-deploy

- Login, callback e recuperação funcionam.
- Dashboard carrega sem erros de consulta.
- Escrita simples e composta retornam sucesso/erro compreensível.
- Webhook inválido recebe não-2xx; evento válido é idempotente.
- Plano exibido corresponde ao banco.
- CI, Vercel e EAS concluíram.
- Logs não contêm payload financeiro sensível ou secrets.

