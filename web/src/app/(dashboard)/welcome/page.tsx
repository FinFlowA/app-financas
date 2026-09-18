import Link from "next/link";

export default function WelcomePage() {
  return <div className="mx-auto max-w-2xl py-10">
    <section className="ff-card p-7 text-center sm:p-10">
      <p className="text-xs font-extrabold uppercase tracking-[.14em] text-primary">Pagamento recebido</p>
      <h1 className="mt-3 text-3xl font-black tracking-tight text-foreground">Bem-vindo ao seu novo plano</h1>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-foreground-muted">A Paddle concluiu o checkout. O FinFlow confirmará a assinatura com segurança pelo servidor antes de liberar os novos recursos.</p>
      <Link href="/" className="ff-focus mt-6 inline-flex min-h-11 items-center justify-center rounded-ff-sm bg-primary px-5 text-sm font-extrabold text-white">Ir para o início</Link>
    </section>
  </div>;
}
