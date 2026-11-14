import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import * as oauth from "oauth4webapi";
import type { OidcConfig } from "./access";
import { getState, setState } from "./db";

/**
 * Sign-in with an OpenID Connect provider (Authentik, Keycloak, Authelia, Google…): the authorization
 * code flow with PKCE. What the browser must bring back (state, nonce, verifier) rides in a short,
 * signed cookie, so nothing is kept on the server between the two legs.
 */
export const FLOW_COOKIE = "notes_oidc";
export const CALLBACK_PATH = "/api/auth/oidc/callback";

export type Flow = { state: string; nonce: string; verifier: string; next: string; bind: string | null; exp: number };

const g = globalThis as unknown as { __notesOidc?: Map<string, { as: oauth.AuthorizationServer; at: number }> };
const discovered = (g.__notesOidc ??= new Map());

// A plain-http issuer only makes sense on a private network (a local Keycloak); the library refuses it unless asked.
const options = (issuer: string) => (issuer.startsWith("http:") ? { [oauth.allowInsecureRequests]: true } : {});

async function server(issuer: string): Promise<oauth.AuthorizationServer> {
  const hit = discovered.get(issuer);
  if (hit && Date.now() - hit.at < 60 * 60_000) return hit.as;
  const url = new URL(issuer);
  let as: oauth.AuthorizationServer;
  try {
    as = await oauth.processDiscoveryResponse(url, await oauth.discoveryRequest(url, { algorithm: "oidc", ...options(issuer) }));
  } catch (error) {
    throw new Error(`Could not read ${issuer}/.well-known/openid-configuration: ${(error as Error).message}`);
  }
  discovered.set(issuer, { as, at: Date.now() });
  return as;
}

const client = (oidc: OidcConfig): oauth.Client => ({ client_id: oidc.clientId });
const clientAuth = (oidc: OidcConfig) => (oidc.clientSecret ? oauth.ClientSecretPost(oidc.clientSecret) : oauth.None());

/* ---------- The flow cookie ---------- */

function key(): string {
  let k = getState<string>("flowKey");
  if (!k) setState("flowKey", (k = randomBytes(32).toString("base64url")));
  return k;
}
const mac = (data: string) => createHmac("sha256", key()).update(data).digest("base64url");

function sealFlow(flow: Flow): string {
  const data = Buffer.from(JSON.stringify(flow)).toString("base64url");
  return `${data}.${mac(data)}`;
}

export function openFlow(cookie: string | undefined): Flow | null {
  const [data, sig] = (cookie ?? "").split(".");
  if (!data || !sig) return null;
  const expected = mac(data);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const flow = JSON.parse(Buffer.from(data, "base64url").toString()) as Flow;
  return flow.exp > Date.now() ? flow : null;
}

export function flowCookie(value: string, secure: boolean, maxAge = 600) {
  // Lax: the provider sends the browser back with a top-level GET, which Lax cookies ride along on.
  return `${FLOW_COOKIE}=${value}; Path=/api/auth/oidc; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

/* ---------- The two legs ---------- */

/** Where to send the browser, and the cookie to set. `bind` names the pending setup this sign-in confirms. */
export async function startSignIn(oidc: OidcConfig, base: string, next: string, bind: string | null): Promise<{ url: string; cookie: string }> {
  const as = await server(oidc.issuer);
  if (!as.authorization_endpoint) throw new Error("The provider has no authorization endpoint.");
  const flow: Flow = {
    state: oauth.generateRandomState(),
    nonce: oauth.generateRandomNonce(),
    verifier: oauth.generateRandomCodeVerifier(),
    next,
    bind,
    exp: Date.now() + 10 * 60_000,
  };
  const url = new URL(as.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: oidc.clientId,
    redirect_uri: base + CALLBACK_PATH,
    response_type: "code",
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: await oauth.calculatePKCECodeChallenge(flow.verifier),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.href, cookie: flowCookie(sealFlow(flow), base.startsWith("https:")) };
}

/** Checks the provider's answer and returns who signed in. */
export async function finishSignIn(oidc: OidcConfig, base: string, callbackUrl: URL, flow: Flow): Promise<{ subject: string; account: string }> {
  const as = await server(oidc.issuer);
  const params = oauth.validateAuthResponse(as, client(oidc), callbackUrl, flow.state);
  const response = await oauth.authorizationCodeGrantRequest(as, client(oidc), clientAuth(oidc), params, base + CALLBACK_PATH, flow.verifier, options(oidc.issuer));
  const result = await oauth.processAuthorizationCodeResponse(as, client(oidc), response, { expectedNonce: flow.nonce, requireIdToken: true });
  const claims = oauth.getValidatedIdTokenClaims(result)!;
  const account = [claims.email, claims.preferred_username, claims.name].find((v) => typeof v === "string" && v) as string | undefined;
  return { subject: `${claims.iss} ${claims.sub}`, account: account ?? claims.sub };
}
