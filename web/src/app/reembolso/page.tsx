import type { Metadata } from "next";
import LegalShell, { LegalList, LegalSection } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Cancelamento e Reembolso",
  description: "Regras de cancelamento, renovação e reembolso dos planos FinFlow.",
};

export default function RefundPolicyPage() {
  return (
    <LegalShell
      eyebrow="Documento legal"
      title="Política de Cancelamento e Reembolso"
      updatedAt="18 de setembro de 2026"
      description="Como cancelar uma assinatura FinFlow e solicitar análise de reembolso."
    >
      <LegalSection title="1. Renovação e cancelamento">
        <p>Os planos pagos são assinaturas recorrentes mensais ou anuais. O preço e a periodicidade são apresentados antes da confirmação no checkout da Paddle.</p>
        <p>O usuário pode cancelar a renovação pelo portal de cobrança disponível na área de Planos. Após o cancelamento, o acesso pago permanece até o fim do período já contratado, salvo quando a legislação aplicável determinar outra solução.</p>
      </LegalSection>

      <LegalSection title="2. Solicitação de reembolso">
        <p>Pedidos de reembolso podem ser enviados para <a className="font-bold text-primary hover:underline" href="mailto:Finflowfinancas@gmail.com?subject=%5BFinFlow%20-%20Reembolso%5D">Finflowfinancas@gmail.com</a>, informando o e-mail da conta e a identificação da cobrança.</p>
        <LegalList>
          <li>cada pedido será analisado conforme a legislação de defesa do consumidor aplicável;</li>
          <li>quando cabível, o reembolso será processado pelo mesmo provedor e meio da cobrança;</li>
          <li>o prazo de crédito após a aprovação depende do meio de pagamento e da instituição financeira;</li>
          <li>esta política não reduz direitos obrigatórios, inclusive eventual direito de arrependimento.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="3. Cobrança indevida ou não reconhecida">
        <p>Em caso de duplicidade, valor divergente ou cobrança não reconhecida, contate-nos imediatamente pelo e-mail acima. Podemos solicitar informações mínimas para localizar a transação e proteger a conta contra fraude.</p>
      </LegalSection>

      <LegalSection title="4. Contato">
        <p>Dúvidas sobre renovação, cancelamento ou reembolso: <a className="font-bold text-primary hover:underline" href="mailto:Finflowfinancas@gmail.com?subject=%5BFinFlow%20-%20Assinatura%5D">Finflowfinancas@gmail.com</a>.</p>
      </LegalSection>
    </LegalShell>
  );
}
