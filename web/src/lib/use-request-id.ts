"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Gera a chave somente depois da hidratação. Gerá-la no inicializador do
 * useState produz HTML diferente no servidor e no navegador.
 */
export function useRequestId(): [string, () => void] {
  const [id, setId] = useState("");
  const renew = useCallback(() => setId(crypto.randomUUID()), []);

  useEffect(() => {
    const timer = window.setTimeout(renew, 0);
    return () => window.clearTimeout(timer);
  }, [renew]);

  return [id, renew];
}
