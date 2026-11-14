"use client";

import { useState } from "react";
import { Button, Switch } from "@/components/ui";

/** Allow or deny an agent; either way the browser goes back to the agent with the answer. */
export function Consent({ query, name, returnTo, forcedReadOnly }: { query: string; name: string; returnTo: string; forcedReadOnly: boolean }) {
  const [readOnly, setReadOnly] = useState(forcedReadOnly);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const decide = async (allow: boolean) => {
    setBusy(true);
    const res = await fetch("/api/oauth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, allow, readOnly }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (data?.redirect) return location.assign(data.redirect);
    setBusy(false);
    setError(data?.error ?? "Could not reach the server.");
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[14px] leading-relaxed text-muted-foreground">
        <b className="font-medium text-foreground">{name}</b> wants to use your notes through MCP: search and read them
        {readOnly ? "" : ", and create, edit and delete them"}. You can disconnect it any time in Settings.
      </p>
      <label className="flex items-center justify-between gap-6 border-y border-rule py-4">
        <span>
          <span className="block text-[14px]">Read only</span>
          <span className="block text-[12.5px] text-muted-foreground">{forcedReadOnly ? "Every agent is read only (Settings)." : "It can't change anything."}</span>
        </span>
        <Switch label="Read only" checked={readOnly} disabled={forcedReadOnly} onChange={setReadOnly} />
      </label>
      <div className="flex items-center gap-3">
        <Button disabled={busy} onClick={() => decide(true)} className="h-[38px] px-5">
          Allow
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => decide(false)} className="h-[38px]">
          Deny
        </Button>
        <span className="ml-auto truncate font-mono text-[11px] text-faint">returns to {returnTo}</span>
      </div>
      <p role="alert" className="min-h-5 text-[13px] text-destructive">
        {error}
      </p>
    </div>
  );
}
