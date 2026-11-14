import { jsonBody, route } from "@/lib/api";
import { deleteNote, getNote, updateNote } from "@/lib/notes";

type Ctx = RouteContext<"/api/notes/[...path]">;
const title = async ({ params }: Ctx) => (await params).path.join("/");

export const GET = route(async (_, ctx: Ctx) => Response.json(await getNote(await title(ctx))));

/** Body: `{ title?, content?, baseMtime? }`. A new title with a `/` moves the note. `baseMtime` turns on conflict detection (409). */
export const PUT = route(async (request, ctx: Ctx) => {
  const body = await jsonBody(request);
  const note = await updateNote(await title(ctx), { newTitle: body.title, content: body.content, baseMtime: body.baseMtime });
  return Response.json(note);
});

export const DELETE = route(async (_, ctx: Ctx) => {
  await deleteNote(await title(ctx));
  return new Response(null, { status: 204 });
});
