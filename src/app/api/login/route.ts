import { getAccess } from "@/lib/access";
import { checkPassword, clearLoginFailures, clientIp, loginBlockedFor, recordLoginFailure, sessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  const access = getAccess();
  if (access?.mode !== "password") return Response.json({ error: "Password sign-in is not in use." }, { status: 400 });
  const ip = clientIp(request);
  const wait = loginBlockedFor(ip);
  if (wait) {
    return Response.json({ error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.` }, { status: 429 });
  }
  const body = await request.json().catch(() => ({}));
  if (!checkPassword(access, body?.username, body?.password)) {
    recordLoginFailure(ip);
    return Response.json({ error: "Wrong username or password." }, { status: 401 });
  }
  clearLoginFailures(ip);
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", sessionCookie(request, access));
  return response;
}
