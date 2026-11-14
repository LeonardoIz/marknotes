import { z } from "zod";
import { jsonBody, route } from "@/lib/api";
import { getNote, NoteError, updateNote } from "@/lib/notes";
import { toggleTask } from "@/lib/tasks";

/** Body: `{ title, index, checked, baseMtime }`: ticks or unticks the index-th task of the note. */
export const POST = route(async (request) => {
  const { title, index, checked, baseMtime } = z
    .object({ title: z.string(), index: z.number().int().min(0), checked: z.boolean(), baseMtime: z.number() })
    .parse(await jsonBody(request));
  const note = await getNote(title);
  let content: string;
  try {
    content = toggleTask(note.content, index, checked);
  } catch {
    throw new NoteError("That task is no longer in the note.", 409);
  }
  return Response.json(await updateNote(note.title, { content, baseMtime }));
});
