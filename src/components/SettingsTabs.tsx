"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Indicator } from "./ui";

const TABS = [
  ["/settings", "General"],
  ["/settings/trash", "Trash"],
  ["/settings/attachments", "Attachments"],
] as const;

/** The settings' own tabs, under the title; the background slides to the current one. */
export function SettingsTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Settings" className="relative flex h-10 items-center gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--border)]">
      <Indicator />
      {TABS.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          scroll={false}
          aria-current={path === href ? "page" : undefined}
          className={`relative rounded-sm px-3 py-1 text-[13px] transition-colors ${path === href ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
