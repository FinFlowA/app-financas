# Política de Privacidade — FinFlow

**Última atualização:** 14 de maio de 2026

## 1. Quem Somos

O **FinFlow** é um aplicativo de controle financeiro pessoal desenvolvido e mantido por **Luís Henrique Palácio** ("nós", "nosso").

**Responsável pelo Tratamento de Dados:**
- Nome: Luís Henrique Palácio
- E-mail de contato: luispalacio1617@gmail.com
- Aplicativo: FinFlow (`com.luishpalacio.meuappfinancas`)

---

## 2. Dados que Coletamos

### 2.1 Dados fornecidos pelo usuário
| Dado | Finalidade | Base Legal |
|------|-----------|-----------|
| Nome completo | Personalização da interface | Consentimento |
| Endereço de e-mail | Autenticação e recuperação de acesso | Execução de contrato |
| Número de telefone | Identificação opcional do perfil | Consentimento |
| Dados financeiros (contas, lançamentos, categorias, caixinhas, cartões) | Prestação do serviço principal | Execução de contrato |

### 2.2 Dados coletados automaticamente
- **Dados de uso:** frequência de acesso, funcionalidades utilizadas (sem identificação individual)
- **Dados de dispositivo:** modelo, sistema operacional (via Expo SDK — para notificações)
- **Tokens de notificação push** (quando o usuário autoriza)

### 2.3 Dados biométricos
O FinFlow pode utilizar autenticação biométrica (impressão digital ou reconhecimento facial) como camada adicional de segurança. **Os dados biométricos são processados exclusivamente pelo sistema operacional do dispositivo e nunca transmitidos a nossos servidores.**

---

## 3. Como Usamos seus Dados

- **Prestação do serviço:** armazenar e sincronizar suas informações financeiras entre dispositivos
- **Segurança:** autenticação, controle de acesso e detecção de uso indevido
- **Notificações:** enviar lembretes de vencimentos e alertas financeiros (somente com permissão)
- **IA do FinFlow:** seus dados financeiros são enviados à API da Groq (modelo LLaMA) exclusivamente para responder suas perguntas dentro do app. Não armazenamos respostas da IA de forma identificável
- **Melhoria do produto:** análise agregada e anônima de funcionalidades mais usadas

---

## 4. Compartilhamento de Dados

Seus dados **nunca são vendidos** a terceiros. Compartilhamos somente com:

| Parceiro | Finalidade | Política |
|---------|-----------|---------|
| **Supabase (AWS)** | Banco de dados e autenticação | [supabase.com/privacy](https://supabase.com/privacy) |
| **Groq** | Processamento de IA (LLaMA) | [groq.com/privacy](https://groq.com/privacy) |
| **Expo** | Build, atualizações OTA e notificações push | [expo.dev/privacy](https://expo.dev/privacy) |

Todos os parceiros estão sujeitos a acordos de processamento de dados compatíveis com a LGPD.

---

## 5. Conta Conjunta (Parceria)

Ao vincular sua conta com a de um parceiro(a):
- Dados das contas compartilhadas ficam visíveis para ambos
- O vínculo pode ser desfeito a qualquer momento nas Configurações
- Ao desfazer, cada usuário mantém apenas seus próprios dados

---

## 6. Retenção e Segurança

- Seus dados são mantidos enquanto você tiver uma conta ativa no FinFlow
- Utilizamos criptografia em trânsito (TLS 1.3) e em repouso (AES-256 via Supabase/AWS)
- O acesso ao banco de dados é protegido por Row Level Security (RLS) — cada usuário acessa somente seus próprios dados
- Após a exclusão da conta, todos os dados são removidos permanentemente em até 30 dias

---

## 7. Seus Direitos (LGPD — Lei nº 13.709/2018)

Conforme a Lei Geral de Proteção de Dados, você tem direito a:

- **Acesso:** solicitar cópia dos seus dados pessoais
- **Correção:** corrigir dados incompletos ou desatualizados (disponível nas Configurações do app)
- **Exclusão:** apagar sua conta e todos os dados — disponível em Configurações → "Apagar Minha Conta"
- **Portabilidade:** solicitar exportação dos seus dados em formato legível
- **Revogação do consentimento:** desativar notificações ou revogar permissões nas Configurações
- **Oposição:** contestar o uso dos seus dados para finalidades específicas
- **Informação:** saber com quem seus dados são compartilhados (veja Seção 4)

Para exercer qualquer direito, entre em contato: **luispalacio1617@gmail.com**

---

## 8. Crianças e Adolescentes

O FinFlow não é direcionado a menores de 18 anos. Não coletamos intencionalmente dados de crianças ou adolescentes. Caso identifiquemos tais dados, eles serão excluídos imediatamente.

---

## 9. Alterações nesta Política

Podemos atualizar esta Política periodicamente. Notificaremos você por e-mail ou notificação no app sobre mudanças significativas. O uso continuado do FinFlow após a notificação constitui aceitação das alterações.

---

## 10. Contato

Dúvidas, solicitações de dados ou reclamações:

- **E-mail:** luispalacio1617@gmail.com
- **Assunto recomendado:** [FinFlow - Privacidade]

Você também pode registrar reclamações junto à **Autoridade Nacional de Proteção de Dados (ANPD)**: [www.gov.br/anpd](https://www.gov.br/anpd)
