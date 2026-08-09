# Política de Privacidade — FinFlow

**Última atualização:** 8 de agosto de 2026

## 1. Responsáveis pelo tratamento

O **FinFlow** é um aplicativo de organização financeira pessoal desenvolvido e mantido por **Luís Henrique Palácio e Gabriel Henrique**, responsáveis pelas decisões sobre o tratamento descrito nesta Política.

Contato: **Finflowfinancas@gmail.com**

## 2. Dados tratados

| Categoria | Exemplos | Finalidade principal |
|---|---|---|
| Cadastro e perfil | Nome, e-mail, telefone celular opcional, data de nascimento e identificador da conta | Criar, autenticar, recuperar e personalizar a conta, registrar o aceite dos documentos e confirmar a idade mínima. |
| Dados financeiros inseridos | Contas, saldos, receitas, despesas, categorias, objetivos, cartões, compras e faturas | Entregar as funções de organização financeira solicitadas. |
| Compartilhamento | Convites, vínculo com parceiro e registros compartilhados | Operar a função compartilhada quando ambos optarem por utilizá-la. |
| Suporte | Feedback, sugestões, reclamações e mensagens | Responder solicitações e melhorar o serviço. |
| Dispositivo | Permissão de notificação, preferências locais, fila temporária de operações offline e dados técnicos necessários | Programar lembretes, guardar preferências, proteger a sessão e sincronizar ações solicitadas quando a conexão voltar. |
| Interações com IA | Perguntas, respostas, propostas de ação, contexto financeiro mínimo e métricas técnicas de uso do modelo | Fornecer o assistente financeiro quando ele for acionado, preparar ações solicitadas, controlar custos e prevenir abuso. |

As notificações financeiras atuais são programadas localmente no aparelho. O FinFlow não registra token de notificação push no servidor enquanto esse recurso não estiver implementado.

### Modo offline

Quando o usuário solicita uma operação compatível sem conexão, o aplicativo pode manter temporariamente no dispositivo os dados necessários para tentar a sincronização depois. Em Android e iOS, o conteúdo financeiro da fila fica no cofre criptografado do sistema; somente identificadores opacos permanecem no armazenamento comum. A fila é isolada por usuário, não guarda senha nem token de sessão e é removida após sincronização confirmada ou descarte explícito. Na demonstração web local, os dados fictícios ficam somente na memória da aba e não são enviados ao Supabase.

Algumas alterações podem exigir conexão quando não for possível garantir conflitos, permissões ou consistência de saldos com segurança. O aplicativo informa esses casos e não simula sucesso.

### Biometria

O FinFlow apenas pede ao sistema operacional que confirme a identidade do usuário. Impressão digital e reconhecimento facial permanecem no dispositivo e não são recebidos pelo FinFlow.

### Telefone opcional

O usuário pode informar o telefone no cadastro, alterá-lo ou removê-lo na área de segurança. No momento, o FinFlow não envia SMS para confirmar esse número. Por isso, um telefone informado é identificado como não verificado e não é utilizado para autenticação, recuperação da conta, comprovação de identidade ou bloqueio de cadastros duplicados.

## 3. Bases legais e usos

Dados necessários à conta e às funções escolhidas são tratados principalmente para executar o serviço solicitado. O telefone opcional é tratado somente para manter o perfil atualizado enquanto não houver confirmação disponível. Permissões opcionais, como notificações, dependem da escolha do usuário. Obrigações legais e defesa de direitos podem justificar tratamentos específicos quando aplicável.

O FinFlow não utiliza os dados financeiros para conceder crédito, vender produtos financeiros ou tomar decisões automatizadas com efeitos jurídicos sobre o usuário.

## 4. Fornecedores e transferência internacional

O FinFlow não vende dados pessoais. Conforme as funções utilizadas, dados podem ser processados por:

- **Supabase:** autenticação e banco de dados;
- **Brevo:** entrega de e-mails transacionais;
- **Expo:** distribuição técnica e atualizações do aplicativo;
- **OpenAI ou Groq:** mensagens e contexto mínimo do assistente financeiro, somente quando o recurso for acionado. O provedor ativo pode mudar por disponibilidade, custo e qualidade, mas uma solicitação é enviada a apenas um provedor por vez.

Fornecedores podem processar dados fora do Brasil, observadas medidas contratuais e técnicas compatíveis com a legislação. Dados também poderão ser divulgados para cumprir obrigação legal, ordem válida de autoridade ou proteger direitos e segurança.

## 5. Conta compartilhada

O compartilhamento é opcional. Após aceitar o vínculo, cada participante poderá visualizar e interagir com os registros definidos como compartilhados.

Quando uma parceria for encerrada:

- cada conta deixa de ser compartilhada e permanece com o usuário que a criou;
- cada participante decide individualmente se deseja manter cada caixinha compartilhada;
- quem optar por manter informa o saldo que permanecerá em sua caixinha individual;
- a soma dos saldos destinados aos participantes não pode ultrapassar o saldo total existente no momento da separação;
- quem optar por não manter terá sua decisão registrada como descarte, sem criação de uma caixinha individual.

## 6. Retenção e segurança

Os dados são mantidos enquanto a conta estiver ativa e pelo tempo necessário às finalidades informadas, ao cumprimento de obrigações legais, à prevenção de fraude e ao exercício de direitos. Operações offline permanecem no dispositivo somente até a sincronização confirmada ou o descarte. Conversas, propostas e auditoria operacional do assistente são eliminadas por uma rotina global diária quando ultrapassam 30 dias, ressalvada necessidade legal devidamente justificada. O usuário pode apagar imediatamente as próprias conversas pelo aplicativo; os registros técnicos de propostas e auditoria seguem a janela operacional de 30 dias. Contagens técnicas de requisições, provedor, modelo e quantidade de tokens, sem o conteúdo da conversa ou dos dados financeiros, são eliminadas pela mesma rotina quando ultrapassam 90 dias. Propostas não confirmadas deixam de poder ser executadas em até 30 minutos. O telefone opcional pode ser removido pelo usuário na área de segurança. Após pedido de exclusão, os dados são excluídos ou anonimizados, ressalvadas hipóteses legais de retenção e cópias temporárias de segurança.

### Assistente financeiro e decisões

O assistente é limitado ao controle financeiro. Ele recebe apenas o contexto necessário para responder ao pedido ou preparar uma ação. Qualquer alteração de dados é apresentada previamente e depende de confirmação explícita no botão do aplicativo. A confirmação é vinculada ao usuário, expira e não pode ser reutilizada para duplicar uma operação. O assistente não altera credenciais, identidade, parceria ou assinatura.

No aplicativo instalado, o token temporário de confirmação fica no armazenamento seguro do sistema operacional e é removido ao confirmar, cancelar, expirar, limpar a conversa ou trocar de usuário. Na versão web, esse token não é persistido no navegador.

São adotadas medidas razoáveis de segurança, incluindo autenticação, conexões protegidas e controles de acesso. Nenhum sistema é totalmente imune; incidentes relevantes serão tratados conforme a legislação.

## 7. Direitos sob a LGPD

O usuário pode solicitar:

- confirmação do tratamento e acesso;
- correção de dados incompletos, inexatos ou desatualizados;
- anonimização, bloqueio ou eliminação de dados desnecessários ou irregulares;
- portabilidade, conforme regulamentação aplicável;
- informações sobre compartilhamento e sobre a possibilidade de não consentir;
- revogação do consentimento e eliminação dos dados tratados com essa base, quando cabível;
- oposição a tratamento irregular;
- revisão de decisões unicamente automatizadas, quando houver.

O perfil, as notificações, a parceria e a exclusão da conta podem ser controlados no aplicativo. Para outros pedidos, utilize **Finflowfinancas@gmail.com**. A identidade do solicitante poderá ser confirmada antes do atendimento.

## 8. Idade mínima

O FinFlow é destinado exclusivamente a pessoas com **18 anos ou mais**. A data de nascimento é solicitada no cadastro para confirmar esse requisito. Cadastros que indiquem idade inferior a 18 anos não são permitidos.

## 9. Atualizações

Esta Política pode mudar para refletir alterações no produto ou na legislação. Mudanças relevantes serão comunicadas de modo adequado, e a versão vigente permanecerá na página oficial.

## 10. Contato

Dúvidas, solicitações de privacidade ou reclamações:

- **E-mail:** Finflowfinancas@gmail.com
- **Assunto recomendado:** `[FinFlow - Privacidade]`

Se uma solicitação relativa à LGPD não for solucionada, o titular poderá recorrer à Autoridade Nacional de Proteção de Dados e aos órgãos de defesa do consumidor, conforme aplicável.
