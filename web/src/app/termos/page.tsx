import type { Metadata } from "next";
import LegalShell, { LegalList, LegalSection } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Termos de Uso | FinFlow",
  description: "Termos aplicáveis ao uso do FinFlow.",
};

export default function TermsPage() {
  return (
    <LegalShell
      eyebrow="Documento legal"
      title="Termos de Uso"
      updatedAt="8 de agosto de 2026"
      description="Regras essenciais para usar o FinFlow, incluindo conta, planos, parceria e assistente financeiro."
    >
      <LegalSection title="1. Aceitação">
        <p>Antes de criar uma conta, o usuário deve declarar que leu e concorda com estes Termos e com a Política de Privacidade. O FinFlow registra a versão dos documentos e a data do aceite junto ao cadastro.</p>
        <p>Se não concordar, o usuário não deve criar nem utilizar uma conta.</p>
      </LegalSection>

      <LegalSection title="2. O serviço">
        <p>O FinFlow ajuda a registrar e visualizar contas, movimentações, categorias, objetivos, cartões, compras, faturas, projeções, relatórios, lembretes e registros compartilhados com parceiro autorizado. Algumas funções podem estar em desenvolvimento, teste, exigir conexão ou ser limitadas por plano.</p>
        <p className="rounded-ff-md border border-orange/25 bg-orange/10 p-4 font-semibold text-foreground">O FinFlow é uma ferramenta de organização. Não é banco, instituição de pagamento, corretora, consultoria contábil ou de investimentos e não movimenta dinheiro por conta própria.</p>
      </LegalSection>

      <LegalSection title="3. Conta, idade e segurança">
        <LegalList>
          <li>O serviço é destinado somente a pessoas com 18 anos ou mais.</li>
          <li>A data de nascimento e os demais dados de cadastro devem ser informados corretamente.</li>
          <li>O telefone celular é opcional e, enquanto não confirmado, não é usado para entrar, recuperar a conta ou comprovar identidade.</li>
          <li>Senha, dispositivo, códigos temporários e sessão devem ser protegidos e não podem ser cedidos ou comercializados.</li>
          <li>Uso não autorizado deve ser comunicado ao canal de contato.</li>
        </LegalList>
        <p>O usuário é responsável pelos registros inseridos e por conferir valores, datas, saldos e projeções antes de tomar decisões. O acesso depende da confirmação do e-mail, não do recebimento de SMS.</p>
      </LegalSection>

      <LegalSection title="4. Planos e cobrança">
        <p>O FinFlow pode oferecer planos com limites e recursos diferentes. Preço, periodicidade, cobrança recorrente, renovação, cancelamento e eventual reembolso são apresentados antes da contratação.</p>
        <p>Enquanto o meio de pagamento não estiver ativo e não houver confirmação expressa da compra, a exibição de plano ou preço não representa cobrança. O retorno do checkout também não ativa recursos sozinho: o status é confirmado diretamente com o provedor.</p>
      </LegalSection>

      <LegalSection title="5. Uso permitido">
        <p>É proibido:</p>
        <LegalList>
          <li>utilizar o serviço para fins ilícitos ou fraudulentos;</li>
          <li>acessar contas sem autorização ou explorar falhas;</li>
          <li>introduzir código malicioso ou interferir na infraestrutura;</li>
          <li>automatizar acessos abusivos;</li>
          <li>copiar ou distribuir o produto em desacordo com a lei.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="6. Assistente de IA">
        <p>Quando disponível, o assistente opera exclusivamente no controle financeiro do FinFlow. Ele pode consultar registros, preparar alterações e auxiliar nas operações financeiras disponíveis nas telas, conforme o plano contratado.</p>
        <p>Toda escrita exige prévia e confirmação explícita no botão do aplicativo. Mensagens afirmativas isoladas não executam propostas. Mesmo após a confirmação, a operação pode ser recusada se os dados mudarem, o limite do plano for atingido ou uma regra financeira não puder ser satisfeita.</p>
        <p>Respostas e projeções podem conter imprecisões e não constituem recomendação financeira, jurídica, contábil, tributária, de crédito ou de investimento. O assistente não movimenta dinheiro em instituições financeiras nem altera identidade, credenciais, parceria ou assinatura.</p>
      </LegalSection>

      <LegalSection title="7. Parceria e dados compartilhados">
        <p>Convite e aceite devem ser voluntários. Cada participante responde pelo que compartilha e pelas ações realizadas em sua conta.</p>
        <p>Ao encerrar a parceria:</p>
        <LegalList>
          <li>cada conta compartilhada permanece com quem a criou;</li>
          <li>cada usuário decide se manterá ou descartará sua versão de cada objetivo compartilhado;</li>
          <li>quem mantiver deverá definir o saldo que permanecerá no objetivo individual;</li>
          <li>os saldos definidos pelos participantes, somados, não podem superar o saldo registrado no momento da separação.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="8. Disponibilidade e mudanças">
        <p>O serviço pode passar por manutenção ou indisponibilidade temporária. Recursos podem ser corrigidos, alterados ou descontinuados, preservados os direitos aplicáveis e com comunicação quando necessária.</p>
        <p>Operações locais ou offline somente são registradas quando o FinFlow consegue preservar usuário, ordem e idempotência. A sincronização pode ser recusada se o recurso tiver mudado, a permissão não existir mais ou uma regra financeira impedir a operação.</p>
      </LegalSection>

      <LegalSection title="9. Propriedade intelectual">
        <p>Nome, identidade, interfaces, textos e software são protegidos e pertencem aos respectivos titulares. É concedida somente licença pessoal, limitada, revogável, não exclusiva e intransferível para uso regular do aplicativo.</p>
      </LegalSection>

      <LegalSection title="10. Responsabilidades">
        <p>Os resultados dependem dos dados inseridos e podem sofrer falhas. Na extensão permitida pela lei, o FinFlow não responde por decisões tomadas exclusivamente com base em projeções, relatórios ou respostas automáticas, nem por eventos fora de controle razoável.</p>
        <p>Nada nestes Termos afasta direitos ou garantias obrigatórios do consumidor.</p>
      </LegalSection>

      <LegalSection title="11. Encerramento">
        <p>O acesso pode ser limitado em caso de fraude, risco de segurança, determinação legal, idade incompatível ou violação destes Termos. O usuário pode excluir a conta nas configurações; a ação é permanente, ressalvadas retenções legalmente permitidas.</p>
      </LegalSection>

      <LegalSection title="12. Alterações">
        <p>Mudanças relevantes serão informadas e, quando exigido, será solicitado novo aceite. A versão vigente e sua data permanecem disponíveis nesta página.</p>
      </LegalSection>

      <LegalSection title="13. Lei e conflitos">
        <p>Aplicam-se as leis brasileiras. Permanecem preservados os direitos do consumidor, inclusive o foro legalmente competente de seu domicílio quando aplicável.</p>
      </LegalSection>

      <LegalSection title="14. Contato">
        <p><strong className="text-foreground">Responsáveis:</strong> Luís Henrique Palácio e Gabriel Henrique.</p>
        <p><strong className="text-foreground">E-mail:</strong> <a className="font-bold text-primary hover:underline" href="mailto:Finflowfinancas@gmail.com?subject=%5BFinFlow%20-%20Termos%5D">Finflowfinancas@gmail.com</a></p>
      </LegalSection>
    </LegalShell>
  );
}
