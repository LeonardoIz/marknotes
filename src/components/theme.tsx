"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { THEME_KEY, type Theme } from "@/lib/theme";
import { Indicator } from "./ui";


/** Whether the page is drawn dark right now: the fixed theme, else the system's. */
export function isDark() {
  const fixed = document.documentElement.dataset.theme;
  return fixed ? fixed === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
  window.dispatchEvent(new Event("notes:theme"));
}

const choices: { value: Theme; label: string; Icon: LucideIcon }[] = [
  { value: "system", label: "Follow the system", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

const subscribe = () => () => {};

/** System, light or dark, switched with a crossfade where the browser can. */
export function ThemeSwitch() {
  const initial = useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.theme as Theme | undefined) ?? "system",
    () => null,
  );
  const [chosen, setChosen] = useState<Theme | null>(null);
  const theme = chosen ?? initial;
  if (theme === null) return <span aria-hidden className="h-[30px] w-[82px]" />;

  const choose = (next: Theme) => {
    if (next === theme) return;
    setChosen(next);
    const root = document.documentElement;
    if (!document.startViewTransition) return apply(next);
    root.setAttribute("data-theme-switching", "");
    document.startViewTransition(() => apply(next)).finished.finally(() => root.removeAttribute("data-theme-switching"));
  };

  return (
    <div role="radiogroup" aria-label="Theme" className="relative inline-flex items-center rounded-lg border p-0.5">
      <Indicator />
      {choices.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => choose(value)}
          className={`relative grid size-6 place-items-center rounded-sm transition-colors ${
            theme === value ? "text-foreground" : "text-faint hover:text-foreground"
          }`}
        >
          <Icon aria-hidden className="size-3.5" strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
}
