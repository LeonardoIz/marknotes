import { jsonBody, route } from "@/lib/api";
import { createNote } from "@/lib/notes";

export const POST = route(async (request) => {
  const body = await jsonBody(request);
  return Response.json(await createNote(body.title, body.content), { status: 201 });
});
