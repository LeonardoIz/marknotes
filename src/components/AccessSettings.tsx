"use client";

import { useState } from "react";
import type { AccessSummary } from "@/lib/access";
import { AccessFields, draftFrom } from "./AccessFields";
import { Button } from "./ui";

function describe(a: AccessSummary) {
  if (a.mode === "none") return "Off: anyone who reaches this server gets in.";
  if (a.mode === "password") return `Username and password, as ${a.username}.`;
  return `Single sign-on with ${a.oidc?.label}, as ${a.oidc?.account}.`;
}

/** The current way in, and the same fields as setup to change it. A new provider is only saved after signing in with it. */
export function AccessSettings({ access, error: initialError }: { access: AccessSummary; error: string }) {
  const [open, setOpen] = useState(!!initialError);
  const [draft, setDraft] = useState(draftFrom(access));
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access: draft }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    // A full load: the old session may no longer count, and every page should see the new way in.
    if (res?.ok && data?.redirect) return location.assign(data.redirect);
    setBusy(false);
    setError(data?.error ?? "Could not reach the server.");
  };

  return (
    <div className="border-b border-rule py-4">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <div className="text-[14px]">Sign-in</div>
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{describe(access)}</div>
        </div>
        {!open && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Change
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-5 flex animate-in flex-col gap-5 duration-200 fade-in">
          <AccessFields draft={draft} onChange={setDraft} current={access} />
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Saving a new method or password signs every browser out. Locked out? Create an empty file named{" "}
            <code className="font-mono text-[11.5px]">reset-access</code> in the notes folder&apos;s <code className="font-mono text-[11.5px]">.notes/</code> and
            setup runs again; notes and settings stay.
          </p>
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={busy} onClick={save}>
              {busy ? "Saving" : draft.mode === "oidc" ? "Sign in with the provider to save" : "Save"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setDraft(draftFrom(access));
                setError("");
              }}
            >
              Cancel
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
