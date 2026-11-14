import path from "node:path";

/**
 * Server settings only: where the notes live and how the server is reached. Who may sign in, and how,
 * is set up in the app on first start (see access.ts), never here.
 */
export const config = {
  notesPath: path.resolve(/*turbopackIgnore: true*/ process.env.NOTES_PATH ?? "data"),
  // The address people and agents use, e.g. https://notes.example.com. Sign-in with a provider and agent
  // sign-in put it in links they hand out; without it, it is taken from each request's Host header.
  publicUrl: (process.env.NOTES_URL ?? "").replace(/\/+$/, ""),
  maxUploadBytes: Number(process.env.NOTES_MAX_UPLOAD_MB ?? 25) * 1024 * 1024,
};

/** This server's own origin, as the browser or agent sees it (from a request, or a page's headers()). */
export function baseUrl(request: { headers: Pick<Headers, "get">; url?: string }): string {
  if (config.publicUrl) return config.publicUrl;
  const url = request.url ? new URL(request.url) : null;
  // shortcut: trusts X-Forwarded-* like the login throttle does, so it assumes a reverse proxy sets them; set NOTES_URL otherwise.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url?.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? url?.protocol.slice(0, -1) ?? "http";
  return `${proto}://${host}`;
}
