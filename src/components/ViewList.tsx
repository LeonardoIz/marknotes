"use client";

import { Layers, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { View } from "@/lib/db";
import { toast } from "./ui";

export const viewHref = (v: Pick<View, "query" | "sort">) => `/search?q=${encodeURIComponent(v.query)}&sort=${v.sort}`;

/** Saved searches as chips; each can be removed in place. */
export function ViewList({ views }: { views: View[] }) {
  const router = useRouter();
  const remove = async (view: View) => {
    const res = await fetch(`/api/views/${view.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return toast("Could not remove the view.", "error");
    toast(`Removed “${view.name}”`);
    router.refresh();
  };
  return (
    <ul className="flex flex-wrap gap-2 pt-3">
      {views.map((v) => (
        <li key={v.id} className="group relative animate-in duration-300 fade-in zoom-in-95">
          <Link
            href={viewHref(v)}
            className="flex h-8 items-center gap-2 rounded-lg border bg-card/60 pr-7 pl-3 text-[13px] transition-colors hover:border-ring/60 hover:text-brand"
          >
            <Layers aria-hidden className="size-3.5 text-faint" strokeWidth={1.75} />
            {v.name}
            <span className="font-mono text-[11px] text-faint">{v.query}</span>
          </Link>
          <button
            type="button"
            onClick={() => remove(v)}
            aria-label={`Remove view ${v.name}`}
            className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-faint opacity-40 transition-[opacity,color] group-hover:opacity-100 hover:bg-secondary hover:text-foreground focus-visible:opacity-100"
          >
            <X aria-hidden className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}
