import type { NextRequest } from "next/server";
import { ZodError, z } from "zod";
import { AccessError, accessInput, buildAccess, checkSetupCode, getAccess, holdPending, saveAccess } from "@/lib/access";
import { isValidSession, SESSION_COOKIE, sessionCookie } from "@/lib/auth";
import { baseUrl } from "@/lib/config";
import { updateSettings } from "@/lib/db";
import { startSignIn } from "@/lib/oidc";

const mcpInput = z.object({ enabled: z.boolean(), readOnly: z.boolean() }).nullable().default(null);

/**
 * Sets the way in. On a fresh server this is setup (it needs the code from the server log and also takes
 * the agent choices); afterwards it needs a session. A provider is only saved once someone signs in with it.
 */
export async function POST(request: NextRequest) {
  const current = getAccess();
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Expected a JSON object body." }, { status: 400 });
  if (!current && !checkSetupCode(body.code)) {
    return Response.json({ error: "That setup code is not right. It is in the server log (docker logs, or the terminal running the app)." }, { status: 403 });
  }
  if (current && !isValidSession(request.cookies.get(SESSION_COOKIE)?.value, current)) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }

  let access, mcp;
  try {
    access = buildAccess(accessInput.parse(body.access), current);
    mcp = current ? null : mcpInput.parse(body.mcp);
  } catch (error) {
    if (error instanceof AccessError) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof ZodError) return Response.json({ error: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
    throw error;
  }

  if (access.mode === "oidc") {
    const pending = holdPending(access, mcp);
    try {
      const { url, cookie } = await startSignIn(access.oidc!, baseUrl(request), current ? "/settings" : "/", pending.id);
      const response = Response.json({ redirect: url });
      response.headers.append("Set-Cookie", cookie);
      return response;
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 });
    }
  }

  saveAccess(access);
  if (mcp) updateSettings({ mcpEnabled: mcp.enabled, mcpReadOnly: mcp.readOnly });
  const response = Response.json({ redirect: current ? "/settings" : "/" });
  if (access.mode === "password") response.headers.append("Set-Cookie", sessionCookie(request, access));
  return response;
}
