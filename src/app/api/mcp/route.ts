import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getAccess } from "@/lib/access";
import { baseUrl } from "@/lib/config";
import { findMcpToken, getSettings } from "@/lib/db";
import { createMcpServer } from "@/lib/mcp";
import { findGrant, metadataPath, resourcePath } from "@/lib/oauth";

/**
 * Who is calling: an agent token made in Settings, or an agent that signed in through OAuth (with the
 * same sign-in as the app: password or provider). With sign-in off the notes are open, and so is this.
 */
function agentFor(token: string): { readOnly: boolean } | null {
  if (token) return findMcpToken(token) ?? findGrant(token);
  return getAccess()?.mode === "none" ? { readOnly: false } : null;
}

/** MCP over Streamable HTTP for agents, authenticated with `Authorization: Bearer <token>`. */
async function handle(request: Request): Promise<Response> {
  const settings = getSettings();
  if (!settings.mcpEnabled || !getAccess()) return new Response("Not found", { status: 404 });
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const agent = agentFor(token);
  if (!agent) {
    // RFC 9728: the header points the agent at the metadata, which points it at this server's sign-in.
    const metadata = baseUrl(request) + metadataPath + resourcePath;
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null },
      { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${metadata}"${token ? ', error="invalid_token"' : ""}` } },
    );
  }
  // Stateless: a fresh server and transport per request, nothing kept between calls.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = createMcpServer({ readOnly: agent.readOnly || settings.mcpReadOnly });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
