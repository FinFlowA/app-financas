import Link from "next/link";

export default function FeatureGate({ title, description, plan = "Pro" }: { title: string; description: string; plan?: "Pro" | "Plus" }) {
  return <section className="ff-card mx-auto max-w-3xl p-6 text-center sm:p-9">
    <span className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-primary/25 bg-primary-soft text-primary-dark" aria-hidden="true">
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
    </span>
    <p className="mt-4 text-xs font-extrabold uppercase tracking-[.14em] text-primary-dark">Disponível no plano {plan}</p>
    <h1 className="mt-2 text-2xl font-black text-foreground sm:text-3xl">{title}</h1>
    <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-foreground-muted">{description}</p>
    <Link className="ff-focus mt-6 inline-flex min-h-11 items-center justify-center rounded-ff-sm bg-primary px-5 text-sm font-extrabold text-white" href="/planos">Comparar planos</Link>
  </section>;
}
