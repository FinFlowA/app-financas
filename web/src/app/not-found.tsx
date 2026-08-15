import Link from "next/link";

export default function NotFound() {
  return <main className="grid min-h-screen place-items-center bg-background p-4"><section className="ff-card max-w-md p-8 text-center"><p className="text-sm font-black uppercase text-primary">404</p><h1 className="mt-2 text-3xl font-black">Página não encontrada</h1><p className="mt-2 text-foreground-muted">O endereço pode ter mudado ou não pertence ao FinFlow.</p><Link href="/" className="mt-5 inline-block rounded-ff-sm bg-primary px-5 py-3 font-extrabold text-white">Voltar ao início</Link></section></main>;
}
