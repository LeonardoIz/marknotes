"use client";

import { noteHref } from "@/lib/parse";
import { localTime, toLocalString } from "@/lib/templates";
import { toast } from "./ui";

/** Opens today's daily note (made on first use), "today" being this browser's day. */
export async function openToday(router: { push: (href: string) => void }) {
  const res = await fetch("/api/daily", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ now: toLocalString(localTime()) }),
  }).catch(() => null);
  const data = await res?.json().catch(() => null);
  if (!res?.ok) return toast(data?.error ?? "Could not open today's note.", "error");
  router.push(noteHref(data.title));
}
