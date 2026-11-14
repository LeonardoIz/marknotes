import { jsonBody, route } from "@/lib/api";
import { deleteFolder, renameFolder } from "@/lib/notes";

type Ctx = RouteContext<"/api/folders/[...path]">;
const folder = async ({ params }: Ctx) => (await params).path.join("/");

/** Body: `{ folder }`, the new path: renames or moves the folder with its notes. */
export const PUT = route(async (request, ctx: Ctx) =>
  Response.json({ folder: await renameFolder(await folder(ctx), (await jsonBody(request)).folder) }),
);

/** Only an empty folder. */
export const DELETE = route(async (_, ctx: Ctx) => {
  await deleteFolder(await folder(ctx));
  return new Response(null, { status: 204 });
});
