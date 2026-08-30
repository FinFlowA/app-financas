"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ensureDefaultCategories } from "@/app/(dashboard)/profile-actions";

const running = new Set<string>();

export default function CategoryBootstrap({ userId, initialized }: { userId: string; initialized: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (initialized || running.has(userId)) return;
    running.add(userId);
    void ensureDefaultCategories()
      .then((result) => {
        if (result.status === "success") router.refresh();
      })
      .finally(() => running.delete(userId));
  }, [initialized, router, userId]);
  return null;
}
