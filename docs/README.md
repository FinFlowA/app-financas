# Documentação técnica do FinFlow

Esta pasta é a referência operacional do projeto. Os documentos descrevem o estado confirmado no código da `main`; handoffs datados permanecem como histórico e podem estar desatualizados.

## Por onde começar

| Documento | Finalidade |
|---|---|
| [Arquitetura](./ARQUITETURA.md) | Componentes, responsabilidades e fluxo dos dados |
| [Ambientes e variáveis](./AMBIENTES_E_VARIAVEIS.md) | Configuração local, preview e produção sem expor segredos |
| [Banco de dados](./BANCO_DE_DADOS.md) | Modelo, RLS, migrations e RPCs críticas |
| [Operações financeiras](./OPERACOES_FINANCEIRAS.md) | Regras de saldo, transações, cartões, objetivos e conciliação |
| [Pagamentos e planos](./PAGAMENTOS_E_PLANOS.md) | Paddle no site, direitos de acesso e futuro Google Play Billing |
| [Assistente Finn](./ASSISTENTE_FINN.md) | Arquitetura da IA, confirmação, cotas e retenção |
| [Rotas e telas](./ROTAS_E_TELAS.md) | Mapa funcional do aplicativo e do site |
| [Deploy e operação](./DEPLOY_E_OPERACAO.md) | Publicação, migrations, rollback e rotinas operacionais |
| [Segurança](./SEGURANCA.md) | Fronteiras de confiança, segredos, RLS e resposta a incidentes |
| [Testes](./TESTES.md) | Suítes automáticas e checklists manuais |
| [Continuidade](./CONTINUIDADE.md) | Estado atual, pendências e procedimento de retomada |

## Hierarquia das fontes

Em caso de divergência, use esta ordem:

1. migrations e código da `main`;
2. documentos técnicos desta página;
3. `README.md` da raiz;
4. handoffs datados e auditorias históricas.

Não copie tokens, senhas, chaves privadas, URLs de banco com credenciais ou secrets de webhook para a documentação. Registre apenas o nome da variável e o painel onde ela deve ser configurada.

