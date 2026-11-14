import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getAccess, verifyPassword, type Access } from "./access";

export const SESSION_COOKIE = "notes_session";

const sign = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");
const digest = (s: string) => createHash("sha256").update(s).digest();

/** Session token: `<expiry ms>.<hmac>`. Stateless; changing the way in replaces the secret and so signs everyone out. */
export function createSession(access: Access): { token: string; maxAge: number } {
  const maxAge = access.sessionDays * 24 * 60 * 60;
  const expires = String(Date.now() + maxAge * 1000);
  return { token: `${expires}.${sign(access.secret, expires)}`, maxAge };
}

/** The Set-Cookie header for a new session (https-only when the request came over https). */
export function sessionCookie(request: Request, access: Access): string {
  const { token, maxAge } = createSession(access);
  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

/** Not set up yet counts as signed out: until then only the setup screen opens. */
export function isValidSession(token: string | undefined, access = getAccess()): boolean {
  if (!access) return false;
  if (access.mode === "none") return true;
  if (!token) return false;
  const [expires, mac] = token.split(".");
  if (!expires || !mac || Number(expires) < Date.now()) return false;
  return timingSafeEqual(digest(mac), digest(sign(access.secret, expires)));
}

export function checkPassword(access: Access, username: unknown, password: unknown): boolean {
  if (access.mode !== "password" || typeof username !== "string" || typeof password !== "string") return false;
  // Both are always checked, so a wrong username takes as long as a wrong password.
  const userOk = timingSafeEqual(digest(username.trim().toLowerCase()), digest(access.username.toLowerCase()));
  return verifyPassword(password, access.passwordHash) && userOk;
}

// Login throttling: 5 failures per IP per 15 minutes.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const failures = new Map<string, { count: number; since: number }>();

export function loginBlockedFor(ip: string): number {
  const entry = failures.get(ip);
  if (!entry || Date.now() - entry.since > WINDOW_MS) return 0;
  return entry.count >= MAX_FAILURES ? Math.ceil((entry.since + WINDOW_MS - Date.now()) / 1000) : 0;
}

export function recordLoginFailure(ip: string) {
  const entry = failures.get(ip);
  if (!entry || Date.now() - entry.since > WINDOW_MS) failures.set(ip, { count: 1, since: Date.now() });
  else entry.count++;
}

export const clearLoginFailures = (ip: string) => failures.delete(ip);

// shortcut: trusts X-Forwarded-For, so it assumes a reverse proxy that sets it; without one a client can rotate it.
export const clientIp = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
