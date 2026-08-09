# Testes de segurança do FinFlow

Este roteiro deve ser executado somente contra um projeto Supabase de teste,
com duas contas fictícias e sem dados financeiros reais. Interceptar ou tentar
força bruta contra produção pode bloquear usuários, gerar custos e corromper
dados.

## Verificações automatizadas locais

```bash
npm run security:check
npm run lint -- --no-cache
npm audit --omit=dev
```

- `security:check` procura credenciais hardcoded, segredo exposto por
  `EXPO_PUBLIC_*`, sessão nativa no AsyncStorage, HTTP sem TLS e configurações
  obrigatórias das Edge Functions/RLS.
- O ESLint inclui `eslint-plugin-security` e aponta construções que exigem
  revisão humana.
- A auditoria online repetida em 08/08/2026 com `npm audit` e
  `npm audit --omit=dev` reporta **0 alertas** nas 1.005 dependências. Esse
  resultado, porém, ainda não contempla dois avisos oficiais publicados para a
  versão instalada `image-size@1.2.1`, usada pelo Metro durante o build: loops
  infinitos nos parsers ICNS e JXL/HEIF
  ([GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)
  e [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)).
  A faixa afetada informada é `<=2.0.2` e não existe versão corrigida publicada.
  Portanto, o resultado zerado do `npm audit` não deve ser usado isoladamente
  como liberação da release e não há correção automática segura a aplicar.
- Mitigação atual: Metro rejeita HEIC/HEIF/JXL/ICNS; `security:check` aceita
  apenas PNG de assinatura válida em `assets/`, rejeita links simbólicos e o
  lockfile permanece fixo. O risco residual é indisponibilidade do processo
  Node de build diante de asset malicioso, não leitura ou alteração dos dados
  financeiros no APK. Monitorar atualização de Expo/Metro/image-size antes de
  cada release e remover a mitigação somente quando houver correção oficial.

## Configurações hospedadas que o código não consegue impor sozinho

- Em **Authentication > Password security**, use mínimo de 8 caracteres e
  exija maiúscula, minúscula, número e símbolo. O mesmo contrato está no app e
  no `supabase/config.toml` para o ambiente local.
- Ative proteção contra senhas vazadas enquanto o projeto estiver no plano Pro.
- Em **Authentication > Sessions**, configure expiração por inatividade e tempo
  máximo de sessão. O app também bloqueia com biometria após 2 minutos fora da
  tela ou encerra a sessão local após 15 minutos quando a biometria está
  desativada.
- Em **Authentication > Rate Limits**, replique e ajuste os limites versionados
  em `supabase/config.toml` (`20` entradas/cadastros e `30` verificações a cada
  cinco minutos por IP, além dos tetos de e-mail/SMS). Ative CAPTCHA/Turnstile
  antes do lançamento público. A trava visual do login não substitui o limite
  do servidor.

## Teste controlado de autorização e injeção

1. Crie os usuários fictícios A e B e uma conta financeira para cada um.
2. Capture no proxy uma leitura e uma alteração feitas pelo usuário A.
3. Troque apenas o ID do recurso pelo ID pertencente a B e reenvie.
4. O banco deve responder sem linha alterada ou com `401/403`; nunca deve
   retornar os dados de B.
5. Repita para contas, transações, categorias, objetivos, cartões, itens de
   fatura e parcerias.
6. Em descrições e buscas, use uma entrada inofensiva como
   `' OR 1=1 --`. Ela deve ser tratada como texto comum. O app usa o cliente
   Supabase/PostgREST, que parametriza os valores; RLS continua sendo a barreira
   de autorização.

Nunca altere token JWT, `user_id`, valor de transferência ou destino em uma
conta real. Os testes devem conferir também que categoria e conta referenciadas
pertencem ao usuário ou a uma parceria explicitamente autorizada.

## Burp Suite ou OWASP ZAP com celular

1. Gere um Development Build apontando para o Supabase de teste.
2. No proxy, escute apenas na interface da rede local e em uma porta dedicada.
3. Conecte computador e celular à mesma rede Wi-Fi e configure no celular o IP
   local do computador e a porta do proxy.
4. Instale o certificado raiz temporário do proxy somente no aparelho de teste.
5. Execute a matriz de autorização acima e registre status HTTP e resposta, sem
   salvar senhas, OTPs, tokens ou dados reais nos arquivos do projeto.
6. Ao terminar, remova o proxy do Wi-Fi, desinstale o certificado raiz e apague
   do proxy o histórico que contenha credenciais de teste.

O Expo Go pode ignorar certificados instalados pelo usuário em algumas versões
do Android. Nesse caso, use o Development Build. Não desative validação TLS no
código para fazer o proxy funcionar.

## Força bruta e limites

Não automatize tentativas contra a produção. Em um projeto de teste:

- confirme que rajadas sustentadas de autenticação recebem HTTP `429`;
- confira em **Authentication > Rate Limits** os limites de OTP, verificação,
  e-mail e SMS;
- habilite CAPTCHA/Turnstile no cadastro e recuperação antes do lançamento;
- mantenha o bloqueio local de botão apenas como usabilidade, nunca como única
  proteção — o limite real deve estar no Supabase/servidor;
- valide que a Edge `finance-ai` aplica cotas por usuário e globais antes de
  chamar o provedor.

## APK/AAB e dispositivo

- Rode o APK/AAB de teste no MobSF e revise permissões, componentes exportados,
  URLs, segredos e configuração de backup.
- Em Android/iOS nativo, a sessão deve ficar no Keystore/Keychain via
  `expo-secure-store`; dados financeiros não devem ser gravados em texto simples.
- Confirme em um aparelho real que o alternador de aplicativos oculta o saldo e
  que o FinFlow volta a exigir autenticação local após o período de inatividade.
- Teste logout com notificações futuras agendadas: todas devem ser canceladas e
  os avisos já entregues devem ser removidos.

O MobSF e o proxy exigem um binário e infraestrutura externa; por isso não fazem
parte do teste web local e precisam ser repetidos em cada build candidato a
lançamento.
