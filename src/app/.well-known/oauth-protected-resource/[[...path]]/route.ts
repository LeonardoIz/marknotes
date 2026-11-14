import { baseUrl } from "@/lib/config";
import { getSettings } from "@/lib/db";
import { resourcePath, SCOPE } from "@/lib/oauth";

/** RFC 9728: tells an agent that got a 401 from /api/mcp where to sign in (this same server). */
export function GET(request: Request) {
  if (!getSettings().mcpEnabled) return new Response("Not found", { status: 404 });
  const base = baseUrl(request);
  return Response.json({
    resource: base + resourcePath,
    authorization_servers: [base],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "marknotes",
  });
}
