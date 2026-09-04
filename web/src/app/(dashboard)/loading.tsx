import styles from "../app-states.module.css";

// Trocar de área no painel não deve reabrir a splash do FinFlow: um esqueleto
// leve mantém a barra lateral visível e sinaliza que o conteúdo está a
// caminho, sem o peso do carregamento inicial. O formato precisa condizer com
// o que realmente aparece depois: quase toda página começa com um cabeçalho
// (".ff-page-hero") seguido de listas/linhas de conteúdo — não uma grade de
// cartões iguais, que só se parece com uma ou outra tela específica.
export default function DashboardLoading() {
  return (
    <div className={styles.routeLoading} role="status" aria-live="polite" aria-busy="true" aria-label="Carregando a seção">
      <span className={styles.srOnly}>Carregando a seção...</span>
      <div className={`${styles.skeleton} ${styles.routeLoadingHero}`} aria-hidden="true" />
      {[0, 1, 2, 3].map((item) => (
        <span key={item} className={`${styles.skeleton} ${styles.routeLoadingRow}`} aria-hidden="true" />
      ))}
    </div>
  );
}
