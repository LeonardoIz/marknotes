import { jsonBody, route } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import { NoteError } from "@/lib/notes";
import { resolver } from "@/lib/search";

/** Renders Markdown with the same pipeline as a saved note, for the editor's preview. */
export const POST = route(async (request) => {
  const { content, title } = await jsonBody(request);
  if (typeof content !== "string") throw new NoteError("Expected { content: string }.", 400);
  const { html, headings } = await renderMarkdown(content, await resolver(), typeof title === "string" ? title : undefined);
  return Response.json({ html, headings });
});
