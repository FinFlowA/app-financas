import styles from "../app-states.module.css";

export default function DashboardLoading() {
  return (
    <div className={styles.loadingPage} role="status" aria-live="polite" aria-busy="true">
      <span className={styles.srOnly}>Carregando seu painel financeiro...</span>
      <div className={styles.loadingHeading} aria-hidden="true">
        <span className={`${styles.skeleton} ${styles.headingLine}`} />
        <span className={`${styles.skeleton} ${styles.headingAction}`} />
      </div>

      <section className={styles.loadingHero} aria-hidden="true">
        <div>
          <span className={`${styles.skeleton} ${styles.heroLabel}`} />
          <span className={`${styles.skeleton} ${styles.heroValue}`} />
          <span className={`${styles.skeleton} ${styles.heroBadge}`} />
        </div>
        <div className={styles.heroActions}>
          {[0, 1, 2, 3].map((item) => <span key={item} className={`${styles.skeleton} ${styles.heroAction}`} />)}
        </div>
      </section>

      <div className={styles.loadingColumns} aria-hidden="true">
        <div className={styles.loadingMain}>
          <section className={styles.loadingCard}>
            <span className={`${styles.skeleton} ${styles.cardTitle}`} />
            <div className={styles.statsRow}>
              {[0, 1, 2].map((item) => <span key={item} className={`${styles.skeleton} ${styles.stat}`} />)}
            </div>
            <span className={`${styles.skeleton} ${styles.progress}`} />
          </section>
          <section className={styles.loadingCard}>
            <span className={`${styles.skeleton} ${styles.cardTitle}`} />
            <div className={styles.accountRow}>
              {[0, 1, 2].map((item) => <span key={item} className={`${styles.skeleton} ${styles.account}`} />)}
            </div>
          </section>
        </div>
        <aside className={styles.loadingCard}>
          <span className={`${styles.skeleton} ${styles.cardTitle}`} />
          <div className={styles.listSkeleton}>
            {[0, 1, 2, 3].map((item) => <span key={item} className={`${styles.skeleton} ${styles.listLine}`} />)}
          </div>
        </aside>
      </div>
    </div>
  );
}
