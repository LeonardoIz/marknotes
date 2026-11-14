"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (form: FormData) => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
    }).catch(() => null);
    if (res?.ok) {
      location.assign(next); // full load so every server component sees the new cookie
      return;
    }
    setBusy(false);
    setError((await res?.json().catch(() => null))?.error ?? "Could not reach the server.");
  };

  return (
    <form action={submit} className="flex flex-col gap-3">
      <label htmlFor="username" className="kicker">
        Username
      </label>
      <input
        id="username"
        name="username"
        required
        autoFocus
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        className="h-[42px] w-full rounded-lg border bg-field px-3.5 text-[14px] transition-colors outline-none hover:border-ring/60 focus-visible:border-ring"
      />
      <label htmlFor="password" className="kicker mt-2">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        required
        autoComplete="current-password"
        aria-invalid={!!error}
        aria-describedby={error ? "login-error" : undefined}
        className="h-[42px] w-full rounded-lg border bg-field px-3.5 text-[14px] transition-colors outline-none hover:border-ring/60 focus-visible:border-ring aria-invalid:border-destructive"
      />
      <Button type="submit" disabled={busy} className="h-[42px]">
        {busy ? "Opening" : "Open notes"}
        <ArrowRight aria-hidden strokeWidth={1.75} />
      </Button>
      {/* The line is always there, so an error doesn't push the form around. */}
      <p id="login-error" role="alert" className="min-h-5 text-[13px] text-destructive">
        {error && <span className="animate-in duration-200 fade-in">{error}</span>}
      </p>
    </form>
  );
}
