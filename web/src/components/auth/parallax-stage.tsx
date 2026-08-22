"use client";

import { useEffect, useRef, type ReactNode } from "react";

type ParallaxStageProps = {
  className: string;
  children: ReactNode;
};

/** Move os ornamentos do painel de marca com o mouse (--mx/--my/--near lidos
 * em auth.module.css). Não ativa o listener sob prefers-reduced-motion. */
export function ParallaxStage({ className, children }: ParallaxStageProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    function handleMove(event: MouseEvent) {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const mx = (event.clientX / window.innerWidth) * 2 - 1;
        const my = (event.clientY / window.innerHeight) * 2 - 1;
        const near = 1 - Math.min(1, Math.hypot(mx, my) / 1.4);
        el!.style.setProperty("--mx", mx.toFixed(3));
        el!.style.setProperty("--my", my.toFixed(3));
        el!.style.setProperty("--near", near.toFixed(3));
      });
    }

    window.addEventListener("mousemove", handleMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section ref={ref} data-auth-stage className={className} aria-labelledby="auth-page-title">
      {children}
    </section>
  );
}
