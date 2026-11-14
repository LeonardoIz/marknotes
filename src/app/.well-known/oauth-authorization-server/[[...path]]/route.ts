import { baseUrl } from "@/lib/config";
import { getSettings } from "@/lib/db";
import { SCOPE } from "@/lib/oauth";

/** RFC 8414: where agents register, send you to allow them, and get their tokens. */
export function GET(request: Request) {
  if (!getSettings().mcpEnabled) return new Response("Not found", { status: 404 });
  const base = baseUrl(request);
  return Response.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
  });
}
