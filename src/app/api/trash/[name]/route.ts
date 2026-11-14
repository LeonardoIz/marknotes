import { route } from "@/lib/api";
import { deleteFromTrash, restoreFromTrash } from "@/lib/notes";

type Ctx = RouteContext<"/api/trash/[name]">;

/** Restores the note; answers with the title it came back under. */
export const POST = route(async (_, { params }: Ctx) => Response.json({ title: await restoreFromTrash((await params).name) }));

/** Deletes it for good. */
export const DELETE = route(async (_, { params }: Ctx) => {
  await deleteFromTrash((await params).name);
  return new Response(null, { status: 204 });
});
