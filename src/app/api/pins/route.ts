import { z } from "zod";
import { jsonBody, route } from "@/lib/api";
import { listPins, setPinned } from "@/lib/db";
import { getNote } from "@/lib/notes";

export const GET = route(async () => Response.json(listPins()));

/** Body: `{ title, pinned }`. Only existing notes can be pinned. */
export const POST = route(async (request) => {
  const { title, pinned } = z.object({ title: z.string(), pinned: z.boolean() }).parse(await jsonBody(request));
  if (pinned) await getNote(title);
  setPinned(title, pinned);
  return Response.json({ title, pinned });
});
