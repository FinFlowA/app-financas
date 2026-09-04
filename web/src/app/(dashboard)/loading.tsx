import styles from "../app-states.module.css";

// Trocar de área no painel não deve reabrir a splash do FinFlow: um esqueleto
// leve (cabeçalho + cartões) mantém a barra lateral visível e sinaliza que o
// conteúdo da seção está a caminho, sem o peso do carregamento inicial.
export default function DashboardLoading() {
  return (
    <div className={styles.routeLoading} role="status" aria-live="polite" aria-busy="true" aria-label="Carregando a seção">
      <span className={styles.srOnly}>Carregando a seção...</span>
      <div className={`${styles.skeleton} ${styles.routeLoadingHero}`} aria-hidden="true" />
      <div className={styles.routeLoadingGrid} aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <span key={item} className={`${styles.skeleton} ${styles.routeLoadingCard}`} />
        ))}
      </div>
    </div>
  );
}
