import { route } from "@/lib/api";
import { deleteView } from "@/lib/db";
import { NoteError } from "@/lib/notes";

export const DELETE = route(async (_, { params }: RouteContext<"/api/views/[id]">) => {
  if (!deleteView(Number((await params).id))) throw new NoteError("View not found.", 404);
  return new Response(null, { status: 204 });
});
