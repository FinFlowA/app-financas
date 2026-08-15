"use client";

import { useEffect } from "react";
import { ensureDefaultCategories } from "@/app/(dashboard)/profile-actions";

const running = new Set<string>();

export default function CategoryBootstrap({ userId, initialized }: { userId: string; initialized: boolean }) {
  useEffect(() => {
    if (initialized || running.has(userId)) return;
    running.add(userId);
    void ensureDefaultCategories().finally(() => running.delete(userId));
  }, [initialized, userId]);
  return null;
}
