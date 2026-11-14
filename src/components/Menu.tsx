"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./ui";

export const menuItem =
  "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5";

/** A button that opens a small menu below it; closes on Escape, outside clicks, and after choosing an item. */
export function Menu({ label, icon, children, size = "icon" }: { label: string; icon: ReactNode; children: ReactNode; size?: "icon" | "icon-sm" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size={size} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label}>
        {icon}
      </Button>
      {open && (
        <div
          role="menu"
          onClick={(e) => (e.target as HTMLElement).closest("a, button") && setOpen(false)}
          className="absolute top-[calc(100%+8px)] right-0 z-30 flex min-w-[210px] animate-in flex-col rounded-lg border bg-popover p-1 shadow-lg duration-150 fade-in slide-in-from-top-1"
        >
          {children}
        </div>
      )}
    </div>
  );
}
