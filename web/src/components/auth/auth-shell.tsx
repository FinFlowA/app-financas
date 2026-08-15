import type { ReactNode } from "react";

type AuthShellProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-md overflow-hidden rounded-ff-lg border border-border bg-surface shadow-sm">
        <header className="bg-header px-7 py-7 text-white">
          <p className="mb-1 text-sm font-bold uppercase tracking-[0.18em] text-white/75">
            FinFlow
          </p>
          <h1 className="text-2xl font-extrabold">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-white/80">{description}</p>
        </header>
        <div className="p-7">{children}</div>
      </section>
    </main>
  );
}
