"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While mounted, re-renders the page from the server every `everyMs`, to follow a job that runs there. */
export function RefreshWhile({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
