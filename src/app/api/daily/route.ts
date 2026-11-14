import { jsonBody, route } from "@/lib/api";
import { openDaily } from "@/lib/daily";
import { NoteError } from "@/lib/notes";
import { parseLocalTime } from "@/lib/templates";

/** Body: `{ now }`, the browser's local time as `YYYY-MM-DDTHH:mm:ss`. Returns today's note, made if needed. */
export const POST = route(async (request) => {
  const now = parseLocalTime((await jsonBody(request)).now);
  if (!now) throw new NoteError("Expected { now: 'YYYY-MM-DDTHH:mm:ss' } in local time.", 400);
  const { note, created } = await openDaily(now);
  return Response.json({ title: note.title, created }, { status: created ? 201 : 200 });
});
