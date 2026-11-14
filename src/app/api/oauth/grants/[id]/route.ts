import { route } from "@/lib/api";
import { revokeGrant } from "@/lib/oauth";

/** Disconnects an agent that signed in with OAuth: its tokens stop working at once. */
export const DELETE = route(async (_request, { params }: RouteContext<"/api/oauth/grants/[id]">) => {
  const ok = revokeGrant(Number((await params).id));
  return ok ? Response.json({ ok: true }) : Response.json({ error: "No such agent." }, { status: 404 });
});
