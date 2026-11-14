"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "@/lib/button";

export { buttonClass };

/* ---------- Button ---------- */

export function Button({
  variant,
  size,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type="button" {...props} className={`${buttonClass(variant, size)} ${className}`} />;
}

/* ---------- Indicator: the sliding background of the chosen option in a row ---------- */

const activeChild = '[aria-checked="true"], [aria-current="page"], [aria-pressed="true"]';

export function Indicator() {
  const ref = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    const place = () => {
      const active = el?.parentElement?.querySelector<HTMLElement>(activeChild);
      if (!el) return;
      if (!active) return void (el.style.opacity = "0");
      // The first time, appear in place; after that, slide.
      el.style.transitionDuration = placed.current ? "" : "0s";
      el.style.opacity = "1";
      el.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
      el.style.width = `${active.offsetWidth}px`;
      el.style.height = `${active.offsetHeight}px`;
      placed.current = true;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  });
  return (
    <span
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 rounded-sm bg-secondary opacity-0 transition-[transform,width,height,opacity] duration-300 ease-(--ease)"
    />
  );
}

/* ---------- Toasts: toast() from anywhere, <Toaster/> once in the layout ---------- */

type Toast = { id: number; message: string; error: boolean; leaving?: boolean };

export function toast(message: string, kind: "success" | "error" = "success") {
  window.dispatchEvent(new CustomEvent("notes:toast", { detail: { message, error: kind === "error" } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => {
    setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 180);
  }, []);
  useEffect(() => {
    let id = 0;
    const onToast = (e: Event) => {
      const t = { id: ++id, ...(e as CustomEvent<Omit<Toast, "id">>).detail };
      setItems((list) => [...list.slice(-3), t]);
      setTimeout(() => dismiss(t.id), t.error ? 8000 : 3200);
    };
    window.addEventListener("notes:toast", onToast);
    return () => window.removeEventListener("notes:toast", onToast);
  }, [dismiss]);
  return (
    <div
      aria-live="polite"
      className="no-print pointer-events-none fixed right-6 bottom-6 z-50 flex flex-col items-end gap-2 max-sm:inset-x-4 max-sm:bottom-4 max-sm:items-stretch"
    >
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          role={t.error ? "alert" : "status"}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto flex max-w-[420px] animate-in items-baseline gap-3 rounded-lg border bg-card py-2.5 pr-4 pl-3.5 text-left text-[13px] shadow-[0_8px_30px_-12px_rgb(0_0_0/0.35)] duration-200 fade-in slide-in-from-bottom-2 ${
            t.error ? "border-destructive/50" : ""
          } ${t.leaving ? "animate-out fill-mode-forwards duration-150 fade-out slide-out-to-right-2" : ""}`}
        >
          <span aria-hidden className={`size-[7px] shrink-0 -translate-y-px ${t.error ? "bg-destructive" : "bg-ok"}`} />
          <span className={t.error ? "text-destructive" : undefined}>{t.message}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- Confirm dialog: const [dialog, confirm] = useConfirm(); await confirm({...}) ---------- */

type ConfirmOptions = { title: string; message: ReactNode; confirm: string; cancel?: string; danger?: boolean };

export function useConfirm(): [ReactNode, (options: ConfirmOptions) => Promise<boolean>] {
  const ref = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(ok: boolean) => void>(null);

  const ask = useCallback((next: ConfirmOptions) => {
    setOptions(next);
    requestAnimationFrame(() => {
      ref.current?.showModal();
      // Enter confirms a safe choice; for a destructive one it cancels.
      ref.current?.querySelector<HTMLButtonElement>(next.danger ? "[data-cancel]" : "[data-confirm]")?.focus();
    });
    return new Promise<boolean>((resolve) => (resolver.current = resolve));
  }, []);

  const close = (ok: boolean) => {
    ref.current?.close();
    resolver.current?.(ok);
    resolver.current = null;
  };

  const dialog = (
    <dialog
      ref={ref}
      onCancel={() => close(false)}
      onClick={(e) => e.target === ref.current && close(false)}
      className="m-auto w-[min(92vw,26rem)] rounded-lg border bg-card p-6 text-foreground shadow-2xl backdrop:bg-black/40 open:animate-in open:duration-200 open:fade-in open:zoom-in-[0.98] open:slide-in-from-bottom-1"
    >
      {options && (
        <>
          <h2 className="font-serif text-xl">{options.title}</h2>
          <div className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{options.message}</div>
          <div className="mt-6 flex justify-end gap-2">
            <Button data-cancel variant="ghost" onClick={() => close(false)}>
              {options.cancel ?? "Cancel"}
            </Button>
            <Button data-confirm variant={options.danger ? "destructive" : "default"} onClick={() => close(true)}>
              {options.confirm}
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
  return [dialog, ask];
}

/* ---------- Prompt dialog: const [dialog, prompt] = usePrompt(); await prompt({...}) → text or null ---------- */

type PromptOptions = { title: string; message?: ReactNode; label: string; initial?: string; placeholder?: string; confirm: string };

export function usePrompt(): [ReactNode, (options: PromptOptions) => Promise<string | null>] {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [options, setOptions] = useState<PromptOptions | null>(null);
  const resolver = useRef<(value: string | null) => void>(null);

  const ask = useCallback((next: PromptOptions) => {
    setOptions(next);
    requestAnimationFrame(() => {
      ref.current?.showModal();
      if (input.current) {
        input.current.value = next.initial ?? "";
        input.current.select();
      }
    });
    return new Promise<string | null>((resolve) => (resolver.current = resolve));
  }, []);

  const close = (value: string | null) => {
    ref.current?.close();
    resolver.current?.(value);
    resolver.current = null;
  };

  const dialog = (
    <dialog
      ref={ref}
      onCancel={() => close(null)}
      onClick={(e) => e.target === ref.current && close(null)}
      className="m-auto w-[min(92vw,26rem)] rounded-lg border bg-card p-6 text-foreground shadow-2xl backdrop:bg-black/40 open:animate-in open:duration-200 open:fade-in open:zoom-in-[0.98] open:slide-in-from-bottom-1"
    >
      {options && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = input.current?.value.trim() ?? "";
            if (value) close(value);
          }}
        >
          <h2 className="font-serif text-xl">{options.title}</h2>
          {options.message && <div className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{options.message}</div>}
          <label className="mt-5 flex flex-col gap-2">
            <span className="kicker">{options.label}</span>
            <input
              ref={input}
              placeholder={options.placeholder}
              className="h-[38px] rounded-lg border bg-background px-3 text-[14px] outline-none transition-colors focus:border-brand/60"
            />
          </label>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => close(null)}>
              Cancel
            </Button>
            <Button type="submit">{options.confirm}</Button>
          </div>
        </form>
      )}
    </dialog>
  );
  return [dialog, ask];
}

/* ---------- Switch and segmented choice, using the app’s theme ---------- */

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200 disabled:opacity-50 ${
        checked ? "border-brand bg-brand" : "bg-secondary"
      }`}
    >
      <span
        aria-hidden
        className={`size-3.5 rounded-full shadow-sm transition-transform duration-200 ease-(--ease) ${
          checked ? "translate-x-[18px] bg-background" : "translate-x-[2px] bg-faint"
        }`}
      />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="relative inline-flex rounded-lg border p-0.5 text-[12px]">
      <Indicator />
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          onClick={() => onChange(v)}
          className={`relative rounded-sm px-2.5 py-0.5 transition-colors ${v === value ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
