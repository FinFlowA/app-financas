import Image from "next/image";
import authStyles from "@/components/auth/auth.module.css";
import styles from "../app-states.module.css";

export default function DashboardLoading() {
  return (
    <div className={styles.dashboardSplash} role="status" aria-live="polite" aria-busy="true" aria-label="Carregando seu painel financeiro">
      <div className={authStyles.splashMark} aria-hidden="true">
        <span className={`${authStyles.splashHalo} ${styles.dashboardSplashHalo}`} />
        <span className={`${authStyles.splashOrbit} ${styles.dashboardSplashOrbit}`} />
        <Image className={authStyles.splashLogo} src="/finflow-logo.png" alt="" width={144} height={144} priority unoptimized />
      </div>
      <div className={authStyles.splashTexts}>
        <span className={`${authStyles.splashBrand} ${styles.dashboardSplashBrand}`}>FinFlow</span>
        <span className={`${authStyles.splashLabel} ${styles.dashboardSplashLabel}`}>Carregando seu painel financeiro</span>
      </div>
      <div className={`${authStyles.splashTrack} ${styles.dashboardSplashTrack}`} aria-hidden="true">
        <div className={`${authStyles.splashFill} ${styles.dashboardSplashFill}`} />
        <span className={authStyles.splashShine} />
      </div>
    </div>
  );
}
