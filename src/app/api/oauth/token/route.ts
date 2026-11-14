import { getSettings } from "@/lib/db";
import { exchange, OAuthError } from "@/lib/oauth";

const noStore = { "Cache-Control": "no-store" };

/** Trades a code (with its PKCE verifier) or a refresh token for new tokens. */
export async function POST(request: Request) {
  if (!getSettings().mcpEnabled) return new Response("Not found", { status: 404 });
  const type = request.headers.get("content-type") ?? "";
  const params = type.includes("application/json")
    ? new URLSearchParams(Object.entries((await request.json().catch(() => ({}))) as Record<string, string>))
    : new URLSearchParams(await request.text());
  try {
    return Response.json(exchange(params), { headers: noStore });
  } catch (error) {
    if (error instanceof OAuthError) return Response.json({ error: error.code, error_description: error.message }, { status: error.status, headers: noStore });
    throw error;
  }
}
