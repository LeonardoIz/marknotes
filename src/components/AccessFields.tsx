"use client";

import { Copy } from "lucide-react";
import { useId, useSyncExternalStore } from "react";
import type { AccessMode, AccessSummary } from "@/lib/access";
import { Button, Segmented, toast } from "./ui";

export type AccessDraft = {
  mode: AccessMode;
  username: string;
  password: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  label: string;
  sessionDays: number;
};

export const draftFrom = (a: AccessSummary | null): AccessDraft => ({
  mode: a?.mode ?? "password",
  username: a?.username ?? "",
  password: "",
  issuer: a?.oidc?.issuer ?? "",
  clientId: a?.oidc?.clientId ?? "",
  clientSecret: "",
  label: a?.oidc?.label ?? "",
  sessionDays: a?.sessionDays ?? 30,
});

const noop = () => () => {};
export const useOrigin = () => useSyncExternalStore(noop, () => location.origin, () => "");

export const inputClass =
  "h-[38px] w-full rounded-lg border bg-field px-3 text-[13.5px] transition-colors outline-none placeholder:text-faint hover:border-ring/60 focus-visible:border-ring";

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px]">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-[12px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function CopyLine({ text, label }: { text: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 grow truncate rounded-md border bg-field px-2.5 py-1.5 font-mono text-[11.5px]">{text}</code>
      <Button
        variant="ghost"
        size="sm"
        aria-label={label}
        onClick={async () => {
          await navigator.clipboard.writeText(text).catch(() => null);
          toast("Copied");
        }}
      >
        <Copy aria-hidden />
      </Button>
    </div>
  );
}

/** How people sign in: the same fields at setup and in Settings. `current` is what is saved now, if anything. */
export function AccessFields({ draft, onChange, current }: { draft: AccessDraft; onChange: (d: AccessDraft) => void; current: AccessSummary | null }) {
  const set = <K extends keyof AccessDraft>(key: K, value: AccessDraft[K]) => onChange({ ...draft, [key]: value });
  const origin = useOrigin();
  const keepsPassword = current?.mode === "password";
  const sameClient = current?.oidc && current.oidc.issuer === draft.issuer && current.oidc.clientId === draft.clientId;

  return (
    <div className="flex flex-col gap-5">
      <Segmented
        label="Sign-in method"
        value={draft.mode}
        options={[
          ["password", "Username and password"],
          ["oidc", "Single sign-on (OIDC)"],
          ["none", "Off"],
        ]}
        onChange={(mode) => set("mode", mode)}
      />

      {draft.mode === "none" && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3.5 py-3 text-[13px] leading-relaxed">
          Anyone who can reach this server can read and change every note, and so can any agent. Use it only on a network you trust, or behind a proxy that
          does its own sign-in.
        </p>
      )}

      {draft.mode === "password" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Username">
            {(id) => <input id={id} className={inputClass} value={draft.username} onChange={(e) => set("username", e.target.value)} autoComplete="username" maxLength={60} />}
          </Field>
          <Field label="Password" hint={keepsPassword ? "Leave empty to keep the current one." : "At least 8 characters."}>
            {(id) => (
              <input
                id={id}
                type="password"
                className={inputClass}
                value={draft.password}
                onChange={(e) => set("password", e.target.value)}
                autoComplete="new-password"
                placeholder={keepsPassword ? "Unchanged" : ""}
              />
            )}
          </Field>
        </div>
      )}

      {draft.mode === "oidc" && (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Authentik, Keycloak, Authelia, Pocket ID, Google… Create an app (client) there with this redirect URI, then fill in what it gives you. To finish,
            you sign in with it once: that account becomes the only one allowed in.
          </p>
          <CopyLine text={`${origin}/api/auth/oidc/callback`} label="Copy redirect URI" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Issuer URL" hint="Where /.well-known/openid-configuration lives.">
              {(id) => (
                <input id={id} className={`${inputClass} font-mono text-[12.5px]`} value={draft.issuer} onChange={(e) => set("issuer", e.target.value)} placeholder="https://auth.example.com/…" />
              )}
            </Field>
            <Field label="Button name" hint="Shown as “Continue with …”.">
              {(id) => <input id={id} className={inputClass} value={draft.label} onChange={(e) => set("label", e.target.value)} placeholder="Authentik" maxLength={40} />}
            </Field>
            <Field label="Client ID">
              {(id) => <input id={id} className={`${inputClass} font-mono text-[12.5px]`} value={draft.clientId} onChange={(e) => set("clientId", e.target.value)} />}
            </Field>
            <Field label="Client secret" hint={sameClient ? "Leave empty to keep the current one." : "Empty for a public client."}>
              {(id) => (
                <input
                  id={id}
                  type="password"
                  className={`${inputClass} font-mono text-[12.5px]`}
                  value={draft.clientSecret}
                  onChange={(e) => set("clientSecret", e.target.value)}
                  autoComplete="off"
                  placeholder={sameClient ? "Unchanged" : ""}
                />
              )}
            </Field>
          </div>
        </div>
      )}

      {draft.mode !== "none" && (
        <Field label="Stay signed in for">
          {(id) => (
            <span className="flex items-center gap-2">
              <input
                id={id}
                type="number"
                min={1}
                max={365}
                value={draft.sessionDays}
                onChange={(e) => set("sessionDays", Math.max(1, Math.min(365, Math.round(Number(e.target.value)) || 1)))}
                className={`${inputClass} w-20 text-right font-mono`}
              />
              <span className="font-mono text-[11px] text-faint">days</span>
            </span>
          )}
        </Field>
      )}
    </div>
  );
}
