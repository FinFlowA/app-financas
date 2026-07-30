# FinFlow

Aplicativo mobile de organização financeira pessoal e compartilhada, desenvolvido com React Native, Expo e Supabase.

[![React Native](https://img.shields.io/badge/React_Native-0.81-61DAFB?logo=react&logoColor=white)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-SDK_54-000020?logo=expo&logoColor=white)](https://expo.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)

## Sobre o projeto

O FinFlow reúne contas, receitas, despesas, transferências, objetivos financeiros e cartões de crédito em uma única experiência. O app permite acompanhar valores realizados e agendados, criar recorrências e compartilhar contas específicas com outra pessoa.

O projeto é mantido de forma colaborativa. O histórico completo de autoria está disponível em [Contributors](https://github.com/FinFlowA/app-financas/graphs/contributors).

## Funcionalidades

- Autenticação com Supabase Auth e proteção por biometria.
- Contas financeiras com saldo inicial, arquivamento e compartilhamento.
- Receitas, despesas e transferências entre contas.
- Movimentações realizadas, pendentes, parceladas e recorrentes.
- Recorrências semanais, mensais e anuais.
- Confirmação da data real ao concluir uma movimentação.
- Categorias personalizadas para receitas e despesas.
- Objetivos financeiros e caixinhas.
- Cartões de crédito, compras parceladas e acompanhamento de faturas.
- Pagamento integral ou parcial da fatura.
- Transferência do saldo restante para a próxima fatura, com juros opcionais.
- Fluxo de caixa, relatórios e distribuição por categoria.
- Conta compartilhada com acesso controlado por políticas RLS.
- Assistente financeiro com comandos em linguagem natural.
- Notificações de movimentações, objetivos, fechamento e vencimento de cartões.
- Tema claro e escuro.
- Cache local para melhorar a experiência sem conexão.
- Atualizações OTA distribuídas pelo EAS Update.

## Tecnologias

| Camada | Tecnologias |
|---|---|
| Aplicativo | React Native 0.81, React 19 e TypeScript |
| Plataforma | Expo SDK 54 e Expo Router |
| Backend | Supabase, PostgreSQL e Supabase Auth |
| Segurança de dados | Row Level Security (RLS) |
| Armazenamento local | AsyncStorage e Expo SQLite |
| Inteligência artificial | Groq API e Llama 3.3 70B |
| Recursos mobile | Biometria, notificações locais e EAS Update |

## Arquitetura

### Dados e compartilhamento

Os dados são armazenados no Supabase. Cada registro é associado ao usuário responsável, e as políticas RLS devem garantir que uma pessoa somente acesse dados próprios ou contas explicitamente compartilhadas com ela.

### Transferências

Uma transferência é registrada como uma única movimentação vinculada às contas de origem e destino. O saldo da origem recebe o débito e o destino recebe o crédito, sem duplicar o agendamento no histórico.

### Assistente financeiro

O assistente converte a mensagem do usuário em uma ação estruturada:

```text
Linguagem natural
    → intenção estruturada
    → validação dos campos
    → confirmação do usuário
    → operação no Supabase
```

A IA não deve executar alterações financeiras sem validação e confirmação.

## Executando localmente

### Requisitos

- Node.js LTS
- npm
- Expo CLI por meio do `npx`
- Projeto Supabase configurado
- Conta Expo para builds e atualizações

### Instalação

```bash
git clone https://github.com/FinFlowA/app-financas.git
cd app-financas
npm install
```

Crie um arquivo `.env` na raiz:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=sua-chave-publicavel
EXPO_PUBLIC_GROQ_API_KEY=sua-chave-groq
```

Depois execute:

```bash
npx expo start
```

Comandos úteis:

```bash
npm run android
npm run ios
npm run web
npm run lint
npx tsc --noEmit
```

## Segurança

- Nunca versione o arquivo `.env`.
- Nunca use a chave `service_role` do Supabase no aplicativo.
- A chave publicável/anon do Supabase pode ser utilizada no cliente somente com políticas RLS corretamente configuradas.
- Variáveis com o prefixo `EXPO_PUBLIC_` são incorporadas ao bundle e podem ser extraídas do APK.
- A chave Groq deve ser movida para uma Edge Function ou outro backend antes de uma distribuição pública. Mantê-la como `EXPO_PUBLIC_GROQ_API_KEY` não oferece proteção real.
- Revogue imediatamente qualquer chave que tenha sido publicada, enviada em conversas ou exposta em capturas de tela.

## Builds e atualizações

O projeto usa dois canais principais:

| Canal | Uso |
|---|---|
| `preview` | APK de distribuição interna e testes |
| `production` | Versão destinada aos usuários de produção |

Criar APK de testes:

```bash
npx eas-cli build --platform android --profile preview
```

Publicar uma atualização OTA para o APK interno:

```bash
npx eas-cli update --branch preview --message "descrição da atualização"
```

Publicar em produção:

```bash
npx eas-cli update --branch production --message "descrição da atualização"
```

O canal da atualização deve ser o mesmo canal do build instalado. Um APK `preview` não recebe atualizações publicadas somente em `production`.

## Estrutura principal

```text
app/
  (tabs)/
    index.tsx          painel e contas
    transacoes.tsx     histórico e agendamentos
    caixinhas.tsx      objetivos financeiros
    cartoes.tsx        cartões, compras e faturas
    relatorios.tsx     fluxo de caixa
    configuracoes.tsx  perfil e preferências
  chat-ia.tsx          assistente financeiro
lib/
  supabase.ts          cliente Supabase
  notifications.ts     notificações locais
  transacoes.ts        regras compartilhadas de movimentações
docs/
  supabase-migration.sql
```

## Colaboração e autoria

O repositório está hospedado na organização compartilhada `FinFlowA`, representando a propriedade conjunta do projeto. A autoria de cada alteração é preservada pelo histórico de commits do Git.

Principais participantes:

- Luis Henrique Palacio — criação do projeto e desenvolvimento da base do aplicativo; integração com Supabase e conta conjunta; implementação e evolução do assistente financeiro; cartões, planos, notificações, interface, identidade visual e automações de publicação pelo Expo.
- Gabriel Henrique — desenvolvimento, correções, regras financeiras, documentação, publicação e evolução do aplicativo.
- Demais contribuições automatizadas ou assistidas aparecem no histórico do repositório.

Luis Henrique Palacio e Gabriel Henrique são proprietários da organização e responsáveis pela continuidade do projeto.

## Roadmap

- [ ] Mover a integração Groq para uma função segura no backend.
- [ ] Ampliar testes automatizados das regras financeiras.
- [ ] Importar extratos bancários.
- [ ] Criar dashboard web complementar.
- [ ] Exportar relatórios em PDF.
- [ ] Evoluir o funcionamento offline.

## Responsáveis pelo FinFlow

O FinFlow foi construído e continua sendo evoluído de forma colaborativa por Luis Henrique Palacio e Gabriel Henrique.

| Responsável | Participação | Perfil |
|---|---|---|
| Luis Henrique Palacio | Criação do projeto, arquitetura inicial, Supabase, conta conjunta, assistente financeiro, cartões, planos, notificações, interface, identidade visual e automações do Expo | [@LuishPalacio](https://github.com/LuishPalacio) |
| Gabriel Henrique | Desenvolvimento, correções, regras financeiras, documentação, publicações e evolução do aplicativo | [@GbrielH](https://github.com/GbrielH) |

### Links do projeto

- Código-fonte: [FinFlowA/app-financas](https://github.com/FinFlowA/app-financas)
- Aplicativo no Expo: [@app-financas/meu-app-financas](https://expo.dev/accounts/app-financas/projects/meu-app-financas)
- Documentos legais: [FinFlowA/finflow-legal](https://github.com/FinFlowA/finflow-legal)
- Histórico completo: [commits](https://github.com/FinFlowA/app-financas/commits/main) e [contributors](https://github.com/FinFlowA/app-financas/graphs/contributors)

> O FinFlow pertence à organização compartilhada `FinFlowA`, administrada em conjunto por Luis Henrique Palacio e Gabriel Henrique.

Contribuições, relatos de erro e sugestões são bem-vindos.
