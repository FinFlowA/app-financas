import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import styles from "./assistente.module.css";

export default async function AssistentePage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login");

  return (
    <main className={styles.page}>
      <section className={styles.locked} aria-labelledby="assistant-maintenance-title">
        <div className={styles.lockedIcon} aria-hidden="true">
          <span className="material-icons">build</span>
        </div>
        <p className={styles.eyebrow}>FinFlow</p>
        <h1 id="assistant-maintenance-title">Assistente em manutenção</h1>
        <p className={styles.lockedDescription}>
          Estamos aprimorando a inteligência financeira do FinFlow para oferecer respostas mais rápidas, seguras e úteis.
        </p>
        <p className={styles.lockedDescription}>
          Seus dados e lançamentos permanecem seguros. Nenhuma informação financeira será alterada enquanto o assistente estiver indisponível.
        </p>
      </section>
    </main>
  );
}
