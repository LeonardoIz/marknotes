"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { AccessFields, CopyLine, draftFrom, Field, inputClass, useOrigin } from "@/components/AccessFields";
import { Button, Switch } from "@/components/ui";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t py-7">
      <h2 className="mb-5 flex items-baseline gap-3">
        <span className="font-mono text-[11px] text-faint">0{n}</span>
        <span className="font-serif text-[22px]">{title}</span>
      </h2>
      {children}
    </section>
  );
}

export function SetupForm({ error: initialError }: { error: string }) {
  const [code, setCode] = useState("");
  const [draft, setDraft] = useState(draftFrom(null));
  const [mcp, setMcp] = useState({ enabled: true, readOnly: false });
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const origin = useOrigin();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, access: draft, mcp }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (res?.ok && data?.redirect) return location.assign(data.redirect);
    setBusy(false);
    setError(data?.error ?? "Could not reach the server.");
  };

  return (
    <form onSubmit={submit}>
      <Step n={1} title="Setup code">
        <Field
          label="Code"
          hint={
            <>
              The server printed it when it started: <code className="font-mono text-[11.5px]">docker compose logs</code>, or the terminal running it. It
              keeps anyone else from setting up your server first.
            </>
          }
        >
          {(id) => (
            <input
              id={id}
              required
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXXX-XXXXX"
              className={`${inputClass} max-w-56 font-mono tracking-wider uppercase`}
            />
          )}
        </Field>
      </Step>

      <Step n={2} title="Sign-in">
        <AccessFields draft={draft} onChange={setDraft} current={null} />
      </Step>

      <Step n={3} title="Agents (MCP)">
        <div className="flex flex-col gap-4">
          <label className="flex items-center justify-between gap-6">
            <span>
              <span className="block text-[14px]">Let agents connect</span>
              <span className="block text-[12.5px] leading-relaxed text-muted-foreground">
                Claude Code and other MCP clients can search, read and write notes. They sign in the way you do, and you allow each one.
              </span>
            </span>
            <Switch label="Let agents connect" checked={mcp.enabled} onChange={(enabled) => setMcp({ ...mcp, enabled })} />
          </label>
          {mcp.enabled && (
            <>
              <label className="flex items-center justify-between gap-6">
                <span>
                  <span className="block text-[14px]">Read only</span>
                  <span className="block text-[12.5px] leading-relaxed text-muted-foreground">Agents can search and read, but not create, edit or delete.</span>
                </span>
                <Switch label="Read only" checked={mcp.readOnly} onChange={(readOnly) => setMcp({ ...mcp, readOnly })} />
              </label>
              <div>
                <p className="mb-1.5 text-[12px] text-muted-foreground">For Claude Code:</p>
                <CopyLine text={`claude mcp add --transport http notes ${origin}/api/mcp`} label="Copy command" />
              </div>
            </>
          )}
        </div>
      </Step>

      <div className="flex flex-col gap-3 border-t pt-7">
        <Button type="submit" disabled={busy} className="h-[42px] self-start px-5">
          {busy ? "Saving" : draft.mode === "oidc" ? "Sign in with the provider to finish" : "Finish setup"}
          <ArrowRight aria-hidden strokeWidth={1.75} />
        </Button>
        <p role="alert" className="min-h-5 text-[13px] text-destructive">
          {error && <span className="animate-in duration-200 fade-in">{error}</span>}
        </p>
      </div>
    </form>
  );
}
