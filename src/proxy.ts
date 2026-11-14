import { NextResponse, type NextRequest } from "next/server";
import { getAccess } from "@/lib/access";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";

// Open without a session: signing in, and what agents use (they bring their own tokens, checked there).
const OPEN = /^\/(login$|api\/(login|logout|mcp|oauth\/(register|token)|auth\/oidc\/(start|callback))$|\.well-known\/)/;
// On a fresh server only setup opens (its endpoint checks the setup code), plus the provider's way back to it.
const SETUP = /^\/(setup$|api\/access$|api\/auth\/oidc\/callback$)/;

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const access = getAccess();
  if (!access) {
    if (SETUP.test(pathname)) return NextResponse.next();
    if (pathname.startsWith("/api/") || pathname.startsWith("/.well-known/")) return NextResponse.json({ error: "Not set up yet." }, { status: 503 });
    return NextResponse.redirect(new URL("/setup", request.url));
  }
  if (pathname === "/setup") return NextResponse.redirect(new URL("/", request.url));
  if (OPEN.test(pathname) || isValidSession(request.cookies.get(SESSION_COOKIE)?.value, access)) return NextResponse.next();
  if (pathname.startsWith("/api/") || pathname.startsWith("/attachments/")) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|icon-192.png|icon-512.png|icon-maskable-512.png|manifest.webmanifest).*)"],
};
