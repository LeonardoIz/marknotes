"use client";

import { Copy, KeyRound, Plug, Trash2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import type { McpToken } from "@/lib/db";
import type { Grant } from "@/lib/oauth";
import { CopyLine } from "./AccessFields";
import { formatDate } from "@/lib/format";
import { Button, toast, useConfirm } from "./ui";

const noop = () => () => {};

/**
 * The endpoint, the agents that signed in through OAuth, and tokens for agents that can't sign in
 * (one per agent: made here, shown once, revocable on its own).
 */
export function AgentTokens({ initial, grants: initialGrants, open }: { initial: McpToken[]; grants: Grant[]; open: boolean }) {
  const [tokens, setTokens] = useState(initial);
  const [grants, setGrants] = useState(initialGrants);
  const [name, setName] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, confirm] = useConfirm();
  const endpoint = useSyncExternalStore(noop, () => `${location.origin}/api/mcp`, () => "/api/mcp");

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const res = await fetch("/api/mcp-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), readOnly }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) return toast(data?.error ?? "Could not create the token.", "error");
    const { token, ...saved } = data;
    setTokens((list) => [...list, saved]);
    setFresh({ name: saved.name, token });
    setName("");
    setReadOnly(false);
  };

  const revoke = async (t: McpToken) => {
    const ok = await confirm({
      title: "Revoke token?",
      message: <>{t.name} will no longer be able to reach your notes. This can&apos;t be undone.</>,
      confirm: "Revoke",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/mcp-tokens/${t.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return toast("Could not revoke the token.", "error");
    setTokens((list) => list.filter((x) => x.id !== t.id));
    if (fresh?.name === t.name) setFresh(null);
    toast("Token revoked");
  };

  const disconnect = async (g: Grant) => {
    const ok = await confirm({
      title: "Disconnect agent?",
      message: <>{g.name} will have to ask again to reach your notes.</>,
      confirm: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/oauth/grants/${g.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return toast("Could not disconnect the agent.", "error");
    setGrants((list) => list.filter((x) => x.id !== g.id));
    toast("Agent disconnected");
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text).catch(() => null);
    toast("Copied");
  };

  return (
    <div>
      {dialog}
      <div className="border-b border-rule py-4">
        <div className="text-[14px]">Connect</div>
        <div className="mt-0.5 mb-3 text-[12.5px] leading-relaxed text-muted-foreground">
          {open
            ? "Sign-in is off, so agents connect without asking."
            : "The agent opens this app in your browser; sign in and allow it. For Claude Code:"}
        </div>
        <CopyLine text={`claude mcp add --transport http notes ${endpoint}`} label="Copy command" />
      </div>

      <ul>
        {grants.map((g) => (
          <li key={`g${g.id}`} className="flex items-center gap-3 border-b border-rule py-3 text-[13.5px]">
            <Plug aria-hidden className="size-3.5 shrink-0 text-faint" />
            <span className="min-w-0 grow">
              <span className="block truncate">
                {g.name}
                {g.readOnly && <span className="ml-2 font-mono text-[10.5px] tracking-wide text-faint uppercase">read only</span>}
              </span>
              <span className="flex gap-3 font-mono text-[11px] text-faint" suppressHydrationWarning>
                <span>{g.lastUsedAt ? `used ${formatDate(g.lastUsedAt)}` : "never used"}</span>
                <span>signed in {formatDate(g.createdAt)}</span>
              </span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => disconnect(g)} aria-label={`Disconnect ${g.name}`} title="Disconnect">
              <Trash2 aria-hidden strokeWidth={1.75} />
            </Button>
          </li>
        ))}
        {tokens.map((t) => (
          <li key={t.id} className="flex items-center gap-3 border-b border-rule py-3 text-[13.5px]">
            <KeyRound aria-hidden className="size-3.5 shrink-0 text-faint" />
            <span className="min-w-0 grow">
              <span className="block truncate">
                {t.name}
                {t.readOnly && <span className="ml-2 font-mono text-[10.5px] tracking-wide text-faint uppercase">read only</span>}
              </span>
              <span className="flex gap-3 font-mono text-[11px] text-faint" suppressHydrationWarning>
                <span>{t.lastUsedAt ? `used ${formatDate(t.lastUsedAt)}` : "never used"}</span>
                <span>added {formatDate(t.createdAt)}</span>
              </span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => revoke(t)} aria-label={`Revoke ${t.name}`} title="Revoke">
              <Trash2 aria-hidden strokeWidth={1.75} />
            </Button>
          </li>
        ))}
      </ul>

      {fresh && (
        <div role="status" className="mt-4 animate-in rounded-lg border border-brand/40 bg-brand/5 p-4 duration-200 fade-in">
          <p className="text-[13.5px]">
            Token for <b className="font-medium">{fresh.name}</b>. Copy it now: it won&apos;t be shown again.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 grow truncate rounded-md border bg-field px-2.5 py-1.5 font-mono text-[12px]">{fresh.token}</code>
            <Button variant="outline" size="sm" onClick={() => copy(fresh.token)}>
              <Copy aria-hidden /> Copy
            </Button>
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground">For Claude Code:</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 grow truncate rounded-md border bg-field px-2.5 py-1.5 font-mono text-[11.5px]">
              claude mcp add --transport http notes {endpoint} --header &quot;Authorization: Bearer {fresh.token}&quot;
            </code>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Copy command"
              onClick={() => copy(`claude mcp add --transport http notes ${endpoint} --header "Authorization: Bearer ${fresh.token}"`)}
            >
              <Copy aria-hidden />
            </Button>
          </div>
        </div>
      )}

      <p className="pt-4 text-[12.5px] leading-relaxed text-muted-foreground">For an agent that can&apos;t sign in through the browser, give it a token of its own:</p>
      <form onSubmit={create} className="flex flex-wrap items-center gap-3 border-b border-rule py-4">
        <input
          aria-label="Agent name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Agent name, e.g. Claude Code"
          maxLength={80}
          className="h-8 min-w-0 grow basis-48 rounded-lg border bg-field px-2.5 text-[13px] transition-colors outline-none placeholder:text-faint hover:border-ring/60 focus-visible:border-ring"
        />
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} className="checkbox" />
          Read only
        </label>
        <Button type="submit" variant="outline" size="sm" disabled={busy || !name.trim()}>
          <KeyRound aria-hidden /> Add agent
        </Button>
      </form>
    </div>
  );
}
