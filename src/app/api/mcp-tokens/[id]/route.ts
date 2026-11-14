import { route } from "@/lib/api";
import { deleteMcpToken } from "@/lib/db";
import { NoteError } from "@/lib/notes";

export const DELETE = route(async (_, { params }: RouteContext<"/api/mcp-tokens/[id]">) => {
  if (!deleteMcpToken(Number((await params).id))) throw new NoteError("No such token.", 404);
  return new Response(null, { status: 204 });
});
