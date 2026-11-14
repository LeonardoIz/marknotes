import type { NextRequest } from "next/server";
import { getAccess, saveAccess, takePending, type Access, type Pending } from "@/lib/access";
import { sessionCookie } from "@/lib/auth";
import { baseUrl } from "@/lib/config";
import { updateSettings } from "@/lib/db";
import { finishSignIn, FLOW_COOKIE, flowCookie, openFlow } from "@/lib/oidc";

/**
 * The provider sends the browser back here. A normal sign-in must be the bound account; a sign-in that
 * confirms a new provider setup (from setup or Settings) binds the account that just signed in.
 */
export async function GET(request: NextRequest) {
  const base = baseUrl(request);
  const secure = base.startsWith("https:");
  const flow = openFlow(request.cookies.get(FLOW_COOKIE)?.value);
  const go = (path: string, extra?: string) => {
    const headers = new Headers({ Location: new URL(path, base).href });
    headers.append("Set-Cookie", flowCookie("", secure, 0));
    if (extra) headers.append("Set-Cookie", extra);
    return new Response(null, { status: 303, headers });
  };
  const fail = (message: string) => {
    const page = flow?.bind ? (getAccess() ? "/settings" : "/setup") : "/login";
    return go(`${page}?error=${encodeURIComponent(message)}`);
  };

  if (!flow) return fail("The sign-in took too long, or started in another browser. Try again.");
  let pending: Pending | null = null;
  let target: Access | null;
  if (flow.bind) {
    pending = takePending(flow.bind);
    if (!pending) return fail("This setup expired. Fill it in again.");
    target = pending.access;
  } else {
    target = getAccess();
    if (target?.mode !== "oidc") return fail("Sign-in with a provider is not in use.");
  }

  let who: { subject: string; account: string };
  try {
    who = await finishSignIn(target.oidc!, base, new URL(request.url), flow);
  } catch (error) {
    return fail(`The provider's answer didn't check out: ${(error as Error).message}`);
  }

  if (pending) {
    target = { ...target, oidc: { ...target.oidc!, subject: who.subject, account: who.account } };
    saveAccess(target);
    if (pending.mcp) updateSettings({ mcpEnabled: pending.mcp.enabled, mcpReadOnly: pending.mcp.readOnly });
  } else if (who.subject !== target.oidc!.subject) {
    return fail(`${who.account} is not the account these notes belong to.`);
  }
  return go(flow.next, sessionCookie(request, target));
}
