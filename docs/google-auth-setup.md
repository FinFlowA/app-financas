# Login com Google — configuração de produção

O app e o site usam Google OAuth por meio do Supabase Auth. Client secret e
credenciais do Google nunca devem ser adicionados ao repositório ou enviados ao
cliente.

## Google Cloud

No cliente OAuth do tipo **Web application**, cadastre como redirect URI o
callback exibido pelo provedor Google no painel do Supabase. O formato é:

```text
https://SEU_PROJECT_REF.supabase.co/auth/v1/callback
```

Cadastre também a origem HTTPS pública do site em **Authorized JavaScript
origins**. Não cadastre caminhos nem o esquema móvel nesse campo.

## Supabase Auth

1. Em **Authentication > Providers > Google**, habilite Google e informe o
   Client ID e Client Secret criados no Google Cloud.
2. Em **Authentication > URL Configuration**, configure a URL HTTPS pública do
   site como **Site URL**.
3. Na lista de redirects permitidos, inclua:

```text
https://SEU_DOMINIO/auth/callback
meuappfinancas://auth/callback
meuappfinancas://email-confirmed
meuappfinancas://reset-password
```

4. No Netlify, defina `NEXT_PUBLIC_SITE_URL` com a mesma origem HTTPS, sem barra
   final, e mantenha as variáveis públicas do Supabase configuradas.

## Mesma conta para o mesmo Gmail

O Supabase faz vinculação automática de identidades que possuem o mesmo e-mail
verificado. Assim, entrar com Google usando um Gmail já cadastrado por senha
mantém o mesmo `auth.users.id` e, consequentemente, as mesmas contas,
transações e assinatura. Não implemente vinculação manual por e-mail no banco:
isso ignoraria as garantias de verificação do provedor e poderia permitir
sequestro de conta.

## Verificação

- Teste primeiro com um usuário novo do Google.
- Depois teste um Gmail já confirmado que possua lançamentos no FinFlow.
- Confirme que o `auth.users.id` não mudou e que o histórico existente aparece.
- Teste cancelamento do Google, callback inválido e abertura do callback em
  outro dispositivo; nenhum desses casos deve criar uma sessão.
