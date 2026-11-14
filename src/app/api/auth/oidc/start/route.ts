import type { NextRequest } from "next/server";
import { getAccess } from "@/lib/access";
import { baseUrl } from "@/lib/config";
import { startSignIn } from "@/lib/oidc";

/** "Continue with …" on the login page: off to the provider, back at the callback. */
export async function GET(request: NextRequest) {
  const access = getAccess();
  const next = request.nextUrl.searchParams.get("next") ?? "/";
  // Only a path of this app, never another site (`//evil.com`, `/\evil.com`).
  const target = /^\/(?![/\\])/.test(next) ? next : "/";
  if (access?.mode !== "oidc" || !access.oidc) return Response.redirect(new URL("/login", request.url), 303);
  try {
    const { url, cookie } = await startSignIn(access.oidc, baseUrl(request), target, null);
    return new Response(null, { status: 303, headers: { Location: url, "Set-Cookie": cookie } });
  } catch (error) {
    const login = new URL("/login", baseUrl(request));
    login.searchParams.set("error", (error as Error).message);
    return Response.redirect(login, 303);
  }
}
