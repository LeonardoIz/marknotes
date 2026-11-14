import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db, hashToken } from "./db";

/**
 * The app as an OAuth 2.1 authorization server for its own MCP endpoint, the way the MCP spec asks:
 * an agent registers itself (dynamic client registration), sends you to /oauth/authorize, where you
 * sign in however the app is set up (password or your provider) and allow it, and then trades the
 * one-minute code for tokens. Only public clients with PKCE (S256); tokens are opaque and stored hashed.
 */
const CODE_TTL = 60_000;
const ACCESS_TTL = 60 * 60_000;
const REFRESH_TTL = 30 * 24 * 60 * 60_000;
// shortcut: a hard cap instead of rate limiting registration, which is open by design; raise it or add limits if it ever fills.
const MAX_CLIENTS = 200;

export const SCOPE = "notes";
export const resourcePath = "/api/mcp";
export const metadataPath = "/.well-known/oauth-protected-resource";

export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    /** Set once the agent's redirect is known to be its own: the error can go back to it. */
    public redirectUri?: string,
  ) {
    super(message);
  }
}

const secret = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;
const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/* ---------- Clients ---------- */

export type OAuthClient = { id: string; name: string; redirectUris: string[] };

/** https anywhere, plain http only back to this machine, or an app's own scheme (cursor://…), per RFC 8252. */
export function allowedRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !["javascript:", "data:", "file:", "vbscript:", "blob:"].includes(url.protocol);
}

export function registerClient(body: unknown): Record<string, unknown> {
  const input = (body ?? {}) as { client_name?: unknown; redirect_uris?: unknown; token_endpoint_auth_method?: unknown };
  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every((u) => typeof u === "string" && allowedRedirect(u))) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris must list https URLs, http://localhost ones or app schemes.");
  }
  if (input.token_endpoint_auth_method !== undefined && input.token_endpoint_auth_method !== "none") {
    throw new OAuthError("invalid_client_metadata", 'Only public clients ("token_endpoint_auth_method": "none") are supported.');
  }
  const name = typeof input.client_name === "string" && input.client_name.trim() ? input.client_name.trim().slice(0, 80) : "An agent";
  const id = secret("client");
  const now = Date.now();
  const database = db();
  database.prepare("INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)").run(id, name, JSON.stringify(uris), now);
  // Over the cap, forget the oldest clients that were never allowed in.
  database
    .prepare(
      `DELETE FROM oauth_clients WHERE id IN (
         SELECT id FROM oauth_clients WHERE id NOT IN (SELECT client_id FROM oauth_grants)
         ORDER BY created_at LIMIT max(0, (SELECT count(*) FROM oauth_clients) - ?))`,
    )
    .run(MAX_CLIENTS);
  return {
    client_id: id,
    client_id_issued_at: Math.floor(now / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export function getClient(id: string): OAuthClient | null {
  const row = db().prepare("SELECT id, name, redirect_uris FROM oauth_clients WHERE id = ?").get(id) as
    | { id: string; name: string; redirect_uris: string }
    | undefined;
  return row ? { id: row.id, name: row.name, redirectUris: JSON.parse(row.redirect_uris) } : null;
}

/* ---------- Authorization: what /oauth/authorize checks before asking you ---------- */

export type AuthorizeRequest = { client: OAuthClient; redirectUri: string; state: string | null; challenge: string };

/**
 * Throws a plain Error when the client or redirect is unknown (nowhere safe to send the answer: shown on
 * the page), and an OAuthError carrying the redirect for anything else (sent back to the agent).
 */
export function checkAuthorize(params: URLSearchParams, resource: string): AuthorizeRequest {
  const client = getClient(params.get("client_id") ?? "");
  if (!client) throw new Error("This agent isn't registered here. Start the connection again from the agent.");
  const redirectUri = params.get("redirect_uri") ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!client.redirectUris.includes(redirectUri)) throw new Error("The agent asked to be answered at an address it didn't register.");
  const fail = (code: string, message: string) => new OAuthError(code, message, 400, redirectUri);
  if (params.get("response_type") !== "code") throw fail("unsupported_response_type", "Only response_type=code is supported.");
  const challenge = params.get("code_challenge") ?? "";
  if (params.get("code_challenge_method") !== "S256" || !/^[\w-]{43,128}$/.test(challenge)) throw fail("invalid_request", "PKCE with S256 is required.");
  const asked = params.get("resource");
  if (asked && asked.replace(/\/+$/, "") !== resource) throw fail("invalid_target", `This server only grants access to ${resource}.`);
  return { client, redirectUri, state: params.get("state"), challenge };
}

/** Where to send the browser with an answer for the agent. */
export function answer(redirectUri: string, state: string | null, params: Record<string, string>, issuer: string): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (state !== null) url.searchParams.set("state", state);
  url.searchParams.set("iss", issuer);
  return url.href;
}

export function issueCode(request: AuthorizeRequest, readOnly: boolean): string {
  const code = secret("code");
  const database = db();
  database.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").run(Date.now());
  database
    .prepare("INSERT INTO oauth_codes (hash, client_id, redirect_uri, challenge, read_only, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(hashToken(code), request.client.id, request.redirectUri, request.challenge, readOnly ? 1 : 0, Date.now() + CODE_TTL);
  return code;
}

/* ---------- Token endpoint ---------- */

type TokenResponse = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

function tokens(): { access: string; refresh: string; response: TokenResponse } {
  const access = secret("notes_at");
  const refresh = secret("notes_rt");
  return {
    access,
    refresh,
    response: { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: SCOPE },
  };
}

export function exchange(params: URLSearchParams): TokenResponse {
  const clientId = params.get("client_id") ?? "";
  const database = db();
  const now = Date.now();

  if (params.get("grant_type") === "authorization_code") {
    const hash = hashToken(params.get("code") ?? "");
    const row = database.prepare("SELECT client_id, redirect_uri, challenge, read_only, expires_at FROM oauth_codes WHERE hash = ?").get(hash) as
      | { client_id: string; redirect_uri: string; challenge: string; read_only: number; expires_at: number }
      | undefined;
    // A code works once, even when the attempt fails.
    database.prepare("DELETE FROM oauth_codes WHERE hash = ?").run(hash);
    if (!row || row.expires_at < now) throw new OAuthError("invalid_grant", "The code is unknown, used or expired.");
    if (row.client_id !== clientId) throw new OAuthError("invalid_grant", "The code was issued to another client.");
    if ((params.get("redirect_uri") ?? row.redirect_uri) !== row.redirect_uri) throw new OAuthError("invalid_grant", "redirect_uri doesn't match.");
    const verifier = params.get("code_verifier") ?? "";
    const expected = Buffer.from(row.challenge);
    const got = Buffer.from(s256(verifier));
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new OAuthError("invalid_grant", "code_verifier doesn't match.");
    const t = tokens();
    database
      .prepare(
        "INSERT INTO oauth_grants (client_id, read_only, access_hash, access_expires, refresh_hash, refresh_expires, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(clientId, row.read_only, hashToken(t.access), now + ACCESS_TTL, hashToken(t.refresh), now + REFRESH_TTL, now);
    return t.response;
  }

  if (params.get("grant_type") === "refresh_token") {
    const row = database.prepare("SELECT id, client_id, refresh_expires FROM oauth_grants WHERE refresh_hash = ?").get(hashToken(params.get("refresh_token") ?? "")) as
      | { id: number; client_id: string; refresh_expires: number }
      | undefined;
    if (!row || row.refresh_expires < now || row.client_id !== clientId) throw new OAuthError("invalid_grant", "The refresh token is unknown or expired.");
    // Rotated on every use: an old refresh token stops working.
    const t = tokens();
    database
      .prepare("UPDATE oauth_grants SET access_hash = ?, access_expires = ?, refresh_hash = ?, refresh_expires = ? WHERE id = ?")
      .run(hashToken(t.access), now + ACCESS_TTL, hashToken(t.refresh), now + REFRESH_TTL, row.id);
    return t.response;
  }

  throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
}

/* ---------- Grants: the agents you allowed in ---------- */

export type Grant = { id: number; name: string; readOnly: boolean; createdAt: number; lastUsedAt: number | null };

export function findGrant(accessToken: string): { readOnly: boolean } | null {
  const row = db().prepare("SELECT id, read_only, access_expires, last_used_at FROM oauth_grants WHERE access_hash = ?").get(hashToken(accessToken)) as
    | { id: number; read_only: number; access_expires: number; last_used_at: number | null }
    | undefined;
  const now = Date.now();
  if (!row || row.access_expires < now) return null;
  if (!row.last_used_at || now - row.last_used_at > 60_000) db().prepare("UPDATE oauth_grants SET last_used_at = ? WHERE id = ?").run(now, row.id);
  return { readOnly: !!row.read_only };
}

export function listGrants(): Grant[] {
  const database = db();
  database.prepare("DELETE FROM oauth_grants WHERE refresh_expires < ?").run(Date.now());
  return (
    database
      .prepare(
        `SELECT g.id, c.name, g.read_only, g.created_at, g.last_used_at FROM oauth_grants g
         JOIN oauth_clients c ON c.id = g.client_id ORDER BY g.created_at`,
      )
      .all() as { id: number; name: string; read_only: number; created_at: number; last_used_at: number | null }[]
  ).map((r) => ({ id: r.id, name: r.name, readOnly: !!r.read_only, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

export const revokeGrant = (id: number) => db().prepare("DELETE FROM oauth_grants WHERE id = ?").run(id).changes > 0;
