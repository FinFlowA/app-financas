"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function entrar(event: React.FormEvent) {
    event.preventDefault();
    setCarregando(true);
    setErro(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

    if (error) {
      setErro("E-mail ou senha inválidos.");
      setCarregando(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={entrar}
        className="w-full max-w-sm rounded-ff-lg border border-border bg-surface p-8 shadow-sm"
      >
        <h1 className="mb-1 text-2xl font-extrabold text-foreground">FinFlow</h1>
        <p className="mb-6 text-sm text-foreground-muted">
          Entre com a mesma conta que você usa no app.
        </p>

        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">
          E-mail
        </label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mb-4 w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 text-foreground outline-none focus:border-primary"
        />

        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-foreground-muted">
          Senha
        </label>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={senha}
          onChange={(event) => setSenha(event.target.value)}
          className="mb-5 w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 text-foreground outline-none focus:border-primary"
        />

        {erro && <p className="mb-4 text-sm font-medium text-red">{erro}</p>}

        <button
          type="submit"
          disabled={carregando}
          className="w-full rounded-ff-md bg-primary py-3 text-sm font-bold text-white transition disabled:opacity-60"
        >
          {carregando ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
