import type { Metadata } from "next";
import LegalShell, { LegalList, LegalSection } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: "Como o FinFlow trata e protege dados pessoais.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      eyebrow="Documento legal"
      title="Política de Privacidade"
      updatedAt="8 de agosto de 2026"
      description="Entenda quais dados são tratados, para quais finalidades e como exercer seus direitos sob a LGPD."
    >
      <LegalSection title="1. Responsáveis pelo tratamento">
        <p>O <strong className="text-foreground">FinFlow</strong> é um aplicativo de organização financeira pessoal desenvolvido e mantido por <strong className="text-foreground">Luís Henrique Palácio e Gabriel Henrique de Alves Lima</strong>, responsáveis pelas decisões sobre o tratamento descrito nesta Política.</p>
        <p>Contato: <a className="font-bold text-primary hover:underline" href="mailto:Finflowfinancas@gmail.com?subject=%5BFinFlow%20-%20Privacidade%5D">Finflowfinancas@gmail.com</a></p>
      </LegalSection>

      <LegalSection title="2. Dados tratados">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["Cadastro e perfil", "Nome, e-mail, telefone opcional, data de nascimento, identificador da conta e aceite dos documentos."],
            ["Dados financeiros", "Contas, saldos, receitas, despesas, categorias, objetivos, cartões, compras e faturas inseridos pelo usuário."],
            ["Compartilhamento", "Convites, vínculo com parceiro, escolhas de compartilhamento e registros da separação."],
            ["Suporte", "Feedback, sugestões, reclamações e mensagens enviadas à equipe."],
            ["Dispositivo", "Permissão de notificação, preferências locais, fila temporária de operações e dados técnicos necessários."],
            ["Interações com IA", "Perguntas, respostas, contexto financeiro mínimo e métricas técnicas quando o assistente é acionado."],
            ["Assinatura", "Plano, periodicidade, status, identificadores técnicos e datas da cobrança; dados do cartão ficam com o provedor."],
          ].map(([title, text]) => (
            <div key={title} className="rounded-ff-md border border-border bg-surface-muted p-4">
              <h3 className="font-extrabold text-foreground">{title}</h3>
              <p className="mt-1 text-xs leading-6">{text}</p>
            </div>
          ))}
        </div>
        <p>As preferências financeiras e a permissão do navegador ficam localmente no dispositivo. Avisos obrigatórios de parceria são persistidos para que possam ser consultados no FinFlow.</p>
      </LegalSection>

      <LegalSection title="3. Bases legais e usos">
        <p>Dados necessários à conta e às funções escolhidas são tratados principalmente para executar o serviço solicitado. Permissões opcionais, como notificações do navegador, dependem da escolha do usuário. Obrigações legais, prevenção de fraude e defesa de direitos podem justificar tratamentos específicos quando aplicável.</p>
        <p>O FinFlow não utiliza dados financeiros para conceder crédito, vender produtos financeiros ou tomar decisões automatizadas com efeitos jurídicos sobre o usuário.</p>
      </LegalSection>

      <LegalSection title="4. Fornecedores e transferência internacional">
        <p>O FinFlow não vende dados pessoais. Conforme as funções utilizadas, dados podem ser processados por:</p>
        <LegalList>
          <li><strong className="text-foreground">Supabase:</strong> autenticação e banco de dados;</li>
          <li><strong className="text-foreground">Brevo:</strong> entrega de e-mails transacionais;</li>
          <li><strong className="text-foreground">Expo:</strong> distribuição técnica e atualizações do aplicativo;</li>
          <li><strong className="text-foreground">Mercado Pago:</strong> checkout, cobrança recorrente e confirmação da assinatura;</li>
          <li><strong className="text-foreground">OpenAI ou Groq:</strong> processamento do assistente, somente quando o recurso for acionado.</li>
        </LegalList>
        <p>Fornecedores podem processar dados fora do Brasil. Nesses casos, são observadas as garantias exigidas pela Lei Geral de Proteção de Dados (LGPD) para transferência internacional, como cláusulas contratuais padrão ou declaração de adequação do país de destino. Dados também podem ser divulgados para cumprir obrigação legal, ordem válida ou proteger direitos e segurança.</p>
      </LegalSection>

      <LegalSection title="5. Conta compartilhada">
        <p>O compartilhamento é opcional. Após o aceite, cada participante pode visualizar e interagir apenas com os registros definidos como compartilhados.</p>
        <p>Quando uma parceria é encerrada:</p>
        <LegalList>
          <li>cada conta deixa de ser compartilhada e permanece com quem a criou;</li>
          <li>cada participante decide individualmente se manterá cada objetivo compartilhado;</li>
          <li>quem mantiver informa o saldo que permanecerá na versão individual;</li>
          <li>a soma dos saldos destinados aos participantes não pode superar o total existente na separação;</li>
          <li>as decisões e o resumo da separação são aplicados por rotinas atômicas do banco.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="6. Retenção e segurança">
        <p>Os dados são mantidos enquanto a conta estiver ativa e pelo tempo necessário às finalidades informadas, ao cumprimento de obrigações legais, à prevenção de fraude e ao exercício de direitos. Após pedido de exclusão, os dados são excluídos ou anonimizados, ressalvadas hipóteses legais de retenção e cópias temporárias de segurança.</p>
        <p>Conversas, propostas e auditoria operacional do assistente são eliminadas por rotina global diária quando ultrapassam 30 dias, salvo necessidade legal. Métricas técnicas sem conteúdo de conversa ou dados financeiros são eliminadas quando ultrapassam 90 dias. Propostas não confirmadas expiram rapidamente e não podem ser reutilizadas.</p>
        <p>São adotadas medidas razoáveis de segurança, incluindo autenticação, conexões protegidas, controle de acesso por usuário, operações financeiras atômicas e confirmação do status de cobrança com o provedor. Nenhum sistema é totalmente imune; incidentes relevantes serão tratados conforme exige a Lei Geral de Proteção de Dados (LGPD), inclusive quanto à comunicação à Autoridade Nacional de Proteção de Dados e aos titulares quando aplicável.</p>
      </LegalSection>

      <LegalSection title="7. Assistente financeiro e decisões">
        <p>O assistente recebe apenas o contexto necessário para responder ao pedido ou preparar uma ação. Alterações de dados são apresentadas previamente e dependem de confirmação explícita. A confirmação é vinculada ao usuário, expira e não pode ser reutilizada para duplicar uma operação.</p>
        <p>O assistente não altera credenciais, identidade, parceria ou assinatura. Na versão web, a proposta e o token temporário de confirmação ficam somente no armazenamento da aba atual, pelo prazo curto de validade, e são removidos ao confirmar, cancelar, expirar ou encerrar a sessão. Eles não são colocados no cache do site nem compartilhados entre abas.</p>
      </LegalSection>

      <LegalSection title="8. Direitos sob a LGPD">
        <p>O titular pode solicitar:</p>
        <LegalList>
          <li>confirmação do tratamento e acesso aos dados;</li>
          <li>correção de dados incompletos, inexatos ou desatualizados;</li>
          <li>anonimização, bloqueio ou eliminação de dados desnecessários ou irregulares;</li>
          <li>portabilidade, conforme regulamentação aplicável;</li>
          <li>informações sobre compartilhamento e sobre a possibilidade de não consentir;</li>
          <li>revogação do consentimento e eliminação dos dados tratados com essa base, quando cabível;</li>
          <li>oposição a tratamento irregular e revisão de decisões unicamente automatizadas.</li>
        </LegalList>
        <p>Perfil, preferências, avisos, parceria e exclusão da conta podem ser controlados nas configurações. Para outros pedidos, escreva para o canal de privacidade. A identidade do solicitante pode ser confirmada antes do atendimento.</p>
      </LegalSection>

      <LegalSection title="9. Idade mínima">
        <p>O FinFlow é destinado exclusivamente a pessoas com <strong className="text-foreground">18 anos ou mais</strong>. A data de nascimento é solicitada no cadastro para confirmar esse requisito.</p>
      </LegalSection>

      <LegalSection title="10. Atualizações">
        <p>Esta Política pode mudar para refletir alterações no produto ou na legislação. Mudanças relevantes serão comunicadas de modo adequado, e a versão vigente permanecerá nesta página.</p>
      </LegalSection>

      <LegalSection title="11. Contato">
        <p>Dúvidas, solicitações de privacidade ou reclamações podem ser enviadas para <a className="font-bold text-primary hover:underline" href="mailto:Finflowfinancas@gmail.com?subject=%5BFinFlow%20-%20Privacidade%5D">Finflowfinancas@gmail.com</a>.</p>
        <p>Se uma solicitação relativa à LGPD não for solucionada, o titular pode recorrer à Autoridade Nacional de Proteção de Dados e aos órgãos de defesa do consumidor, conforme aplicável.</p>
      </LegalSection>
    </LegalShell>
  );
}
