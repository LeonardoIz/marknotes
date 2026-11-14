import { getSettings } from "@/lib/db";
import { OAuthError, registerClient } from "@/lib/oauth";

/** RFC 7591 dynamic client registration: an agent introduces itself before asking you in. */
export async function POST(request: Request) {
  if (!getSettings().mcpEnabled) return new Response("Not found", { status: 404 });
  try {
    return Response.json(registerClient(await request.json().catch(() => null)), { status: 201 });
  } catch (error) {
    if (error instanceof OAuthError) return Response.json({ error: error.code, error_description: error.message }, { status: error.status });
    throw error;
  }
}
