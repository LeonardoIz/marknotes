"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatBytes, formatDate } from "@/lib/format";
import type { TrashItem } from "@/lib/notes";
import { Button, toast, useConfirm } from "./ui";

export function TrashList({ items, retentionDays }: { items: TrashItem[]; retentionDays: number }) {
  const router = useRouter();
  const [dialog, confirm] = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (name: string, method: "POST" | "DELETE") => {
    setBusy(name);
    const res = await fetch(`/api/trash/${encodeURIComponent(name)}`, { method }).catch(() => null);
    const data = method === "POST" ? await res?.json().catch(() => null) : null;
    setBusy(null);
    if (!res?.ok) return toast(data?.error ?? "Something went wrong.", "error");
    toast(method === "POST" ? `Restored as “${data.title}”` : "Deleted for good");
    router.refresh();
  };

  const remove = async (item: TrashItem) => {
    const ok = await confirm({
      title: "Delete for good?",
      message: (
        <>
          <b className="font-medium text-foreground">{item.title}</b> will be erased. This can’t be undone.
        </>
      ),
      confirm: "Delete",
      danger: true,
    });
    if (ok) act(item.name, "DELETE");
  };

  const empty = async () => {
    const ok = await confirm({
      title: "Empty the trash?",
      message: `${items.length} ${items.length === 1 ? "note" : "notes"} will be erased. This can’t be undone.`,
      confirm: "Empty trash",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch("/api/trash", { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return toast("Could not empty the trash.", "error");
    toast("Trash emptied");
    router.refresh();
  };

  return (
    <div className="animate-in duration-300 fade-in">
      {dialog}
      <div className="flex items-center justify-between border-b pb-2.5">
        <span className="kicker flex gap-4">
          <span>
            {items.length} {items.length === 1 ? "note" : "notes"}
          </span>
          <span>{retentionDays ? `kept ${retentionDays} days` : "kept forever"}</span>
        </span>
        {items.length > 0 && (
          <Button variant="destructive" size="sm" onClick={empty}>
            Empty trash
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="mt-12 text-center font-serif text-lg text-muted-foreground italic">The trash is empty.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li
              key={item.name}
              className={`flex items-center gap-4 border-b border-rule py-3 transition-opacity duration-300 ${busy === item.name ? "opacity-40" : ""}`}
            >
              <span className="min-w-0 grow">
                <span className="block truncate text-[15px]">{item.title}</span>
                <span className="flex gap-3 font-mono text-[11px] text-faint" suppressHydrationWarning>
                  <span>deleted {formatDate(item.deletedAt)}</span>
                  <span>{formatBytes(item.size)}</span>
                </span>
              </span>
              <Button variant="outline" size="sm" onClick={() => act(item.name, "POST")} disabled={!!busy}>
                <RotateCcw aria-hidden strokeWidth={1.75} />
                Restore
              </Button>
              <Button variant="ghost" size="sm" onClick={() => remove(item)} disabled={!!busy} aria-label={`Delete ${item.title} for good`}>
                <Trash2 aria-hidden strokeWidth={1.75} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-[12.5px] text-muted-foreground">
        Change how long notes stay here in{" "}
        <Link href="/settings" className="underline decoration-border underline-offset-4 hover:decoration-brand">
          General
        </Link>
        .
      </p>
    </div>
  );
}
