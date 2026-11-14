"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SearchBox } from "./SearchBox";
import { openToday } from "./today";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** Global shortcuts: `/` or Ctrl/Cmd+K search, Ctrl+Alt+N new note, Ctrl+Alt+D today's note, Ctrl+Alt+H home. */
export function SearchModal() {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const show = () => {
      setOpen(true);
      ref.current?.showModal();
    };
    const onKey = (e: KeyboardEvent) => {
      if (pathname === "/login") return;
      const mod = e.ctrlKey || e.metaKey;
      if ((mod && e.key.toLowerCase() === "k") || (e.key === "/" && !mod && !isTyping(e.target))) {
        e.preventDefault();
        show();
      } else if (e.ctrlKey && e.altKey && e.code === "KeyN") {
        e.preventDefault();
        router.push("/new");
      } else if (e.ctrlKey && e.altKey && e.code === "KeyD") {
        e.preventDefault();
        void openToday(router);
      } else if (e.ctrlKey && e.altKey && e.code === "KeyH") {
        e.preventDefault();
        router.push("/");
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("notes:search", show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("notes:search", show);
    };
  }, [pathname, router]);

  const close = () => {
    ref.current?.close();
    setOpen(false);
  };

  return (
    <dialog
      ref={ref}
      aria-label="Search"
      onClose={() => setOpen(false)}
      onClick={(e) => e.target === ref.current && close()}
      className="m-auto mt-[12vh] w-[min(560px,calc(100vw-32px))] rounded-lg border bg-popover p-0 text-foreground shadow-2xl backdrop:bg-black/40 open:animate-in open:duration-200 open:fade-in open:slide-in-from-top-2"
    >
      {open && <SearchBox autoFocus onDone={close} />}
      <p className="flex gap-4 border-t px-4 py-2 font-mono text-[11px] text-faint">
        <span>↑↓ move</span>
        <span>enter open</span>
        <span>shift+enter all results</span>
      </p>
    </dialog>
  );
}
