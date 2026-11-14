import { route } from "@/lib/api";
import { listAttachments, NoteError, saveAttachment } from "@/lib/notes";

export const POST = route(async (request) => {
  const file = (await request.formData().catch(() => null))?.get("file");
  if (!(file instanceof File)) throw new NoteError('Expected a multipart "file" field.', 400);
  const name = await saveAttachment(file.name, new Uint8Array(await file.arrayBuffer()));
  return Response.json({ name, url: `/attachments/${encodeURIComponent(name)}` }, { status: 201 });
});

/** Every attachment with its size and the notes that use it. */
export const GET = route(async () => Response.json(await listAttachments()));
