import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "./config";
import { getState, setState } from "./db";

/**
 * Who may open the notes, chosen in the app on first start and changeable in Settings: nobody needs
 * to sign in, a username and password, or an OpenID Connect provider bound to one account.
 * Stored in the app's database; a file named `reset-access` in `.notes/` clears it to run setup again.
 */
export type AccessMode = "none" | "password" | "oidc";
export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Shown on the sign-in button: "Continue with <label>". */
  label: string;
  /** The one account allowed in, bound by signing in once when it was set up. */
  subject: string;
  account: string;
};
export type Access = {
  mode: AccessMode;
  username: string;
  passwordHash: string;
  oidc: OidcConfig | null;
  sessionDays: number;
  /** Signs sessions; replaced when the way in changes, which signs every browser out. */
  secret: string;
};
/** What the screens may see: no hash, no secrets. */
export type AccessSummary = { mode: AccessMode; username: string; sessionDays: number; oidc: Omit<OidcConfig, "clientSecret" | "subject"> | null };

const RESET_FILE = () => path.join(config.notesPath, ".notes", "reset-access");

export function getAccess(): Access | null {
  if (fs.existsSync(RESET_FILE())) {
    setState("access", null);
    setState("accessPending", null);
    fs.rmSync(RESET_FILE(), { force: true });
    console.warn("[marknotes] reset-access found: sign-in settings cleared, setup runs again.");
    announceSetup();
  }
  return getState<Access>("access");
}

export const summarize = (a: Access): AccessSummary => ({
  mode: a.mode,
  username: a.username,
  sessionDays: a.sessionDays,
  oidc: a.oidc && { issuer: a.oidc.issuer, clientId: a.oidc.clientId, label: a.oidc.label, account: a.oidc.account },
});

/* ---------- Passwords ---------- */

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("base64url")}:${scryptSync(password, salt, 32).toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split(":");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, "base64url"), expected.length), expected);
}

/* ---------- Setup code: whoever reaches a fresh server first must also read its log ---------- */

export function setupCode(): string {
  let code = getState<string>("setupCode");
  if (!code) setState("setupCode", (code = randomBytes(5).toString("hex").toUpperCase().replace(/(.{5})/, "$1-")));
  return code;
}

export function checkSetupCode(input: unknown): boolean {
  const code = getState<string>("setupCode");
  const given = typeof input === "string" ? input.trim().toUpperCase() : "";
  return !!code && given.length === code.length && timingSafeEqual(Buffer.from(given), Buffer.from(code));
}

export function announceSetup() {
  console.log(`\n[marknotes] Not set up yet. Open the app and enter this setup code: ${setupCode()}\n`);
}

/* ---------- Changing the way in ---------- */

export const accessInput = z.object({
  mode: z.enum(["none", "password", "oidc"]),
  username: z.string().trim().max(60).default(""),
  // Empty keeps the current password (when it already is password sign-in).
  password: z.string().max(200).default(""),
  issuer: z.string().trim().max(500).default(""),
  clientId: z.string().trim().max(300).default(""),
  clientSecret: z.string().max(1000).default(""),
  label: z.string().trim().max(40).default(""),
  sessionDays: z.number().int().min(1).max(365).default(30),
});
export type AccessInput = z.infer<typeof accessInput>;

export class AccessError extends Error {}

/** The new access from a form, keeping what the form leaves blank (password, client secret) from the current one. */
export function buildAccess(input: AccessInput, current: Access | null): Access {
  const base = { username: "", passwordHash: "", oidc: null, sessionDays: input.sessionDays, secret: randomBytes(32).toString("base64url") };
  if (input.mode === "none") return { ...base, mode: "none" };

  if (input.mode === "password") {
    if (!input.username) throw new AccessError("Choose a username.");
    const keep = current?.mode === "password" && !input.password;
    if (!keep && input.password.length < 8) throw new AccessError("The password needs at least 8 characters.");
    return {
      ...base,
      mode: "password",
      username: input.username,
      passwordHash: keep ? current.passwordHash : hashPassword(input.password),
      // Same password and username: browsers stay signed in.
      secret: keep && current.username === input.username ? current.secret : base.secret,
    };
  }

  let issuer: URL;
  try {
    issuer = new URL(input.issuer);
  } catch {
    throw new AccessError("The issuer must be a URL, like https://auth.example.com/application/o/notes/.");
  }
  if (issuer.protocol !== "https:" && issuer.protocol !== "http:") throw new AccessError("The issuer must be an http(s) URL.");
  if (!input.clientId) throw new AccessError("Enter the client ID from your provider.");
  const sameClient = current?.oidc && current.oidc.issuer === input.issuer && current.oidc.clientId === input.clientId;
  return {
    ...base,
    mode: "oidc",
    oidc: {
      issuer: input.issuer,
      clientId: input.clientId,
      clientSecret: input.clientSecret || (sameClient ? current.oidc!.clientSecret : ""),
      label: input.label || issuer.hostname,
      subject: "",
      account: "",
    },
  };
}

/** Saves the way in; setup is finished the first time this runs. */
export function saveAccess(access: Access) {
  setState("access", access);
  setState("accessPending", null);
  setState("setupCode", null);
}

/* ---------- Provider sign-in waits for one successful sign-in before it is saved ---------- */

export type Pending = { id: string; access: Access; mcp: McpChoice | null; expires: number };
export type McpChoice = { enabled: boolean; readOnly: boolean };

export function holdPending(access: Access, mcp: McpChoice | null): Pending {
  const pending = { id: randomUUID(), access, mcp, expires: Date.now() + 15 * 60_000 };
  setState("accessPending", pending);
  return pending;
}

export function takePending(id: string): Pending | null {
  const pending = getState<Pending>("accessPending");
  if (!pending || pending.id !== id || pending.expires < Date.now()) return null;
  return pending;
}
