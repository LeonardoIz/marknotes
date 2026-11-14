"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { View } from "@/lib/db";
import { Button, toast } from "./ui";

/** Saves the current search as a named view, or removes it if it already is one. */
export function SaveView({ query, sort, existing }: { query: string; sort: View["sort"]; existing?: View }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  if (existing) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-brand hover:text-brand"
        title="Remove this saved view"
        onClick={async () => {
          const res = await fetch(`/api/views/${existing.id}`, { method: "DELETE" }).catch(() => null);
          if (!res?.ok) return toast("Could not remove the view.", "error");
          toast(`Removed “${existing.name}”`);
          router.refresh();
        }}
      >
        <BookmarkCheck aria-hidden strokeWidth={1.75} />
        Saved as “{existing.name}”
      </Button>
    );
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, query, sort }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return toast("Could not save the view.", "error");
    ref.current?.close();
    toast(`Saved “${name.trim()}”`);
    router.refresh();
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setName(query.replace(/^#/, ""));
          ref.current?.showModal();
        }}
      >
        <Bookmark aria-hidden strokeWidth={1.75} />
        Save view
      </Button>
      <dialog
        ref={ref}
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="m-auto w-[min(92vw,26rem)] rounded-lg border bg-card p-6 text-foreground shadow-2xl backdrop:bg-black/40 open:animate-in open:duration-200 open:fade-in open:zoom-in-[0.98] open:slide-in-from-bottom-1"
      >
        <form onSubmit={save} className="flex flex-col gap-4">
          <h2 className="font-serif text-xl">Save view</h2>
          <p className="-mt-2 text-[13px] text-muted-foreground">
            Keeps <code className="font-mono text-[12px] text-foreground">{query}</code> on the home page, one click away.
          </p>
          <label className="flex flex-col gap-2">
            <span className="kicker">Name</span>
            <input
              autoFocus
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 rounded-lg border bg-field px-3 text-[14px] transition-colors outline-none hover:border-ring/60 focus-visible:border-ring"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => ref.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              Save
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
