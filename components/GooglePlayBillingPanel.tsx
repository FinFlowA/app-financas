// O checkout nativo existe apenas no Android. Web continua usando Paddle.
type Props = {
  isDark: boolean;
  userId?: string;
  billingEnabled: boolean;
  currentPlan: "free" | "smart" | "premium";
  refreshEntitlement: () => Promise<void>;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
};

export default function GooglePlayBillingPanel(_props: Props) { return null; }
