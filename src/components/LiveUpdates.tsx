"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/** A note written or removed on disk (by this app, an editor, a sync tool or an agent). `title: null`: folders changed. */
export type NoteChange = { title: string | null; mtime: number | null };

const listeners = new Set<(change: NoteChange) => void>();
let editors = 0;

/** Hear about every change on disk while mounted. */
export function onNoteChange(listener: (change: NoteChange) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** While someone is writing, pages don't refresh under them; the editor decides what to do instead. */
export function holdRefreshes(): () => void {
  editors++;
  return () => void editors--;
}

/** Keeps the open page in step with the notes folder: one event stream, a debounced refresh per burst of changes. */
export function LiveUpdates() {
  const router = useRouter();
  const pathname = usePathname();
  const signedIn = pathname !== "/login";

  useEffect(() => {
    if (!signedIn) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let missed = false;
    const refresh = () => {
      if (document.hidden) return void (missed = true);
      clearTimeout(timer);
      timer = setTimeout(() => editors === 0 && router.refresh(), 250);
    };
    const source = new EventSource("/api/events");
    source.addEventListener("change", (e) => {
      let change: NoteChange;
      try {
        change = JSON.parse((e as MessageEvent<string>).data);
      } catch {
        return;
      }
      for (const listener of listeners) listener(change);
      refresh();
    });
    // A background tab catches up when it comes back instead of refreshing unseen.
    const onVisible = () => {
      if (!document.hidden && missed) {
        missed = false;
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      source.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, signedIn]);

  return null;
}
