import type { Metadata } from "next";
import LegalShell, { LegalList, LegalSection } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Cancelamento e Reembolso",
  description: "Garantia de 30 dias e regras de cancelamento, renovação e reembolso dos planos FinFlow.",
};

export default function RefundPolicyPage() {
  return (
    <LegalShell
      eyebrow="Documento legal"
      title="Política de Cancelamento e Reembolso"
      updatedAt="30 de setembro de 2026"
      description="Garantia de 30 dias na primeira cobrança, cancelamento a qualquer momento e como pedir reembolso."
    >
      <LegalSection title="1. Garantia de 30 dias">
        <p>Se o plano pago não atender você, é possível pedir o <strong className="text-foreground">reembolso integral da primeira cobrança</strong> de uma assinatura em até <strong className="text-foreground">30 dias</strong> após o pagamento, sem precisar justificar.</p>
        <p>A garantia vale para a primeira cobrança de cada assinatura, mensal ou anual. Com o reembolso, a assinatura é encerrada e a conta volta ao plano gratuito, sem perder os dados cadastrados.</p>
      </LegalSection>

      <LegalSection title="2. Renovação e cancelamento">
        <p>Os planos pagos são assinaturas recorrentes mensais ou anuais, renovadas automaticamente. O preço e a periodicidade são apresentados antes da confirmação no checkout da Paddle.</p>
        <p>O cancelamento pode ser feito a qualquer momento pelo portal de cobrança, na área de Planos. Ele interrompe as próximas renovações, e o acesso pago continua até o fim do período já contratado. As renovações seguintes à primeira cobrança não são reembolsáveis, salvo erro de cobrança ou quando a legislação aplicável determinar outra solução.</p>
      </LegalSection>

      <LegalSection title="3. Como pedir o reembolso">
        <p>A Paddle.com é a revendedora online e vendedora registrada (Merchant of Record) dos nossos pedidos, e é ela quem processa os reembolsos. Para pedir:</p>
        <LegalList>
          <li>escreva para <a className="font-bold text-primary hover:underline" href="mailto:Finflowfinancas@gmail.com?subject=%5BFinFlow%20-%20Reembolso%5D">Finflowfinancas@gmail.com</a> informando o e-mail da conta e o número do pedido do recibo da Paddle; ou</li>
          <li>fale diretamente com a Paddle em <a className="font-bold text-primary hover:underline" href="https://paddle.net" target="_blank" rel="noopener noreferrer">paddle.net</a>, usando o e-mail da compra.</li>
        </LegalList>
        <LegalList>
          <li>o valor volta pelo mesmo meio de pagamento usado na compra;</li>
          <li>o prazo para o crédito aparecer depois da aprovação depende do meio de pagamento e da instituição financeira;</li>
          <li>esta política não reduz direitos obrigatórios do consumidor, inclusive o direito de arrependimento.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="4. Cobrança indevida ou não reconhecida">
        <p>Em caso de duplicidade, valor divergente ou cobrança não reconhecida, contate-nos imediatamente pelo e-mail acima. Podemos solicitar informações mínimas para localizar a transação e proteger a conta contra fraude.</p>
      </LegalSection>

      <LegalSection title="5. Contato">
        <p>Dúvidas sobre renovação, cancelamento ou reembolso: <a className="font-bold text-primary hover:underline" href="mailto:Finflowfinancas@gmail.com?subject=%5BFinFlow%20-%20Assinatura%5D">Finflowfinancas@gmail.com</a>.</p>
        <p>Vendedor dos planos pagos: Gabriel Henrique Alves de Lima (pessoa física).</p>
      </LegalSection>
    </LegalShell>
  );
}
