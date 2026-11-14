"use client";

import { CalendarDays, LibraryBig, LogOut, Menu, Plus, Search, Settings, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Logo } from "./Logo";
import { ThemeSwitch } from "./theme";
import { openToday } from "./today";
import { Button, buttonClass } from "./ui";

export const openSearch = () => window.dispatchEvent(new Event("notes:search"));

const noop = () => () => {};

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // ⌘ on a Mac, Ctrl elsewhere; known only in the browser.
  const mac = useSyncExternalStore(noop, () => /Mac|iPhone|iPad/.test(navigator.platform), () => true);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (pathname === "/login") return null;

  const item =
    "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";

  return (
    <header className="no-print sticky top-0 z-20 bg-background/80 shadow-[inset_0_-1px_0_var(--border)] backdrop-blur-md [view-transition-name:header]">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 md:px-10">
        <Link href="/" aria-label="Home" className={`mr-auto transition-opacity duration-300 ${pathname === "/" ? "pointer-events-none opacity-0" : ""}`}>
          <Logo />
        </Link>
        {/* The home page has its own big search box; this one steps aside there, like the logo. */}
        <button
          type="button"
          onClick={openSearch}
          aria-label="Search"
          aria-hidden={pathname === "/" || undefined}
          tabIndex={pathname === "/" ? -1 : undefined}
          className={`flex h-8 w-[220px] items-center gap-2.5 rounded-lg border px-2.5 text-[13px] text-muted-foreground transition-[color,opacity] duration-300 hover:text-foreground max-md:w-8 max-md:justify-center max-md:px-0 ${pathname === "/" ? "pointer-events-none opacity-0" : ""}`}
        >
          <Search aria-hidden className="size-3.5" />
          <span className="max-md:hidden">Search</span>
          <kbd className="ml-auto font-mono text-[11px] text-faint max-md:hidden">{mac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        <Link href="/new" aria-label="New note" className={`${buttonClass("default", "sm")} h-8 max-sm:w-8 max-sm:px-0`} title="New note (Ctrl+Alt+N)">
          <Plus aria-hidden />
          <span className="max-sm:hidden">New note</span>
        </Link>
        <div ref={menuRef} className="relative">
          <Button variant="ghost" size="icon-sm" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Menu">
            <Menu aria-hidden className="size-4" />
          </Button>
          {open && (
            <div
              role="menu"
              onClick={(e) => (e.target as HTMLElement).closest("a, [data-close]") && setOpen(false)}
              className="absolute top-[calc(100%+8px)] right-0 z-30 flex min-w-[220px] animate-in flex-col rounded-lg border bg-popover p-1 shadow-lg duration-150 fade-in slide-in-from-top-1"
            >
              <button role="menuitem" type="button" data-close className={item} onClick={() => openToday(router)}>
                <CalendarDays aria-hidden className="size-3.5" /> Today
                <kbd className="ml-auto font-mono text-[10.5px] text-faint">{mac ? "⌃⌥D" : "Ctrl Alt D"}</kbd>
              </button>
              <Link role="menuitem" href="/notes" className={item}>
                <LibraryBig aria-hidden className="size-3.5" /> All notes
              </Link>
              <Link role="menuitem" href="/settings" className={item}>
                <Settings aria-hidden className="size-3.5" /> Settings
              </Link>
              <Link role="menuitem" href="/settings/trash" className={item}>
                <Trash2 aria-hidden className="size-3.5" /> Trash
              </Link>
              <div className="flex items-center justify-between px-2.5 py-1.5">
                <span className="kicker">Theme</span>
                <ThemeSwitch />
              </div>
              <span className="my-1 h-px bg-border" />
              <button
                role="menuitem"
                type="button"
                data-close
                className={item}
                onClick={async () => {
                  await fetch("/api/logout", { method: "POST" });
                  router.push("/login");
                  router.refresh();
                }}
              >
                <LogOut aria-hidden className="size-3.5" /> Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
