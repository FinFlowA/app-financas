"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export default function RouteFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div key={pathname} className="ff-route-frame">{children}</div>;
}
