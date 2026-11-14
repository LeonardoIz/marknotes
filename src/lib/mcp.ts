import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getSettings } from "./db";
import { listTemplates, openDaily } from "./daily";
import { createFolder, createNote, deleteNote, getNote, listFolders, listNotes, NoteError, updateNote } from "./notes";
import { extractLinks, extractTags, noteName, parentFolder } from "./parse";
import { allTags, backlinks, search } from "./search";
import { semanticSearch, semanticStatus } from "./semantic";
import { applyTemplate, localTime, parseLocalTime } from "./templates";

const noteUri = (title: string) => `note:///${title.split("/").map(encodeURIComponent).join("/")}`;
const uriTitle = (raw: string) => raw.split("/").map((p) => decodeURIComponent(p)).join("/");

const text = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

/** Runs a tool body; a NoteError (bad title, not found, conflict) goes back to the agent as a tool error. */
async function run(body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof NoteError) return { isError: true, content: [{ type: "text", text: error.message }] };
    throw error;
  }
}

const snippetText = (html: string | null) =>
  html
    ?.replace(/<\/?mark>/g, "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))) ?? null;

const noteSummary = (note: { title: string; content: string; mtime: number }) => ({
  title: note.title,
  modified: new Date(note.mtime).toISOString(),
  modified_ms: note.mtime,
});

/**
 * The notes MCP server: one per request (stateless), over the same storage the app uses.
 * `readOnly` comes from the agent's token, the env and the settings screen: any one of them is enough.
 */
export function createMcpServer({ readOnly = false }: { readOnly?: boolean } = {}): McpServer {
  const server = new McpServer(
    { name: "marknotes", version: "0.2.0" },
    {
      instructions:
        "A personal notes app. Notes are Markdown files identified by their path: `Work/Weekly` is the note Weekly in the folder Work " +
        "(a title without / is at the top level). Search before creating to avoid duplicates; search_by_meaning finds notes about " +
        "something even when the words differ. Link notes with [[Name]] or [[Folder/Name]] and tag them with #tag. " +
        "Every note is also a resource at note:///<path>. When editing, pass expected_modified_ms from read_note so changes " +
        "made elsewhere are never overwritten.",
    },
  );

  server.registerResource(
    "note",
    new ResourceTemplate("note:///{+path}", {
      list: async () => ({
        resources: (await listNotes())
          .sort((a, b) => b.mtime - a.mtime)
          .map((n) => ({ uri: noteUri(n.title), name: n.title, title: noteName(n.title), mimeType: "text/markdown" })),
      }),
    }),
    { title: "Note", description: "A note's Markdown, by its path.", mimeType: "text/markdown" },
    async (uri, { path }) => {
      const note = await getNote(uriTitle(String(path)));
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: note.content }] };
    },
  );

  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description:
        "Full-text search over all notes (accent-insensitive, prefix and typo tolerant). `#tag` tokens filter by tag; an empty query or `*` lists every note.",
      inputSchema: {
        query: z.string().describe("Words to find, and/or #tags. Empty or * for all notes."),
        folder: z.string().optional().describe("Only notes in this folder (and its subfolders)."),
        sort: z.enum(["score", "title", "modified"]).optional().describe("Default: score (modified when listing all)."),
        limit: z.number().int().min(1).max(200).optional().describe("Default 20."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ query, folder, sort, limit }) =>
      run(async () => {
        const all = await search(query, sort ?? "score");
        const inFolder = folder?.replace(/^\/+|\/+$/g, "");
        const hits = (inFolder ? all.filter((h) => h.title.startsWith(`${inFolder}/`)) : all).slice(0, limit ?? 20);
        return text(
          hits.map((h) => ({
            title: h.title,
            modified: new Date(h.mtime).toISOString(),
            tags: h.tags,
            snippet: snippetText(h.snippet),
          })),
        );
      }),
  );

  server.registerTool(
    "read_note",
    {
      title: "Read a note",
      description: "The full Markdown of a note, with its tags, outgoing [[links]] and the notes linking to it.",
      inputSchema: { title: z.string().describe('The note\'s path, e.g. "Work/Weekly".') },
      annotations: { readOnlyHint: true },
    },
    ({ title }) =>
      run(async () => {
        const note = await getNote(title);
        const meta = {
          ...noteSummary(note),
          tags: extractTags(note.content),
          links: extractLinks(note.content),
          linked_from: await backlinks(note.title),
        };
        return { content: [{ type: "text", text: JSON.stringify(meta, null, 2) }, { type: "text", text: note.content }] };
      }),
  );

  server.registerTool(
    "search_by_meaning",
    {
      title: "Search notes by meaning",
      description:
        "Semantic search: finds notes about the same thing as the query even with different words or in another language. " +
        "Best for questions and ideas; use search_notes for exact words, names and #tags.",
      inputSchema: {
        query: z.string().min(1).describe("A question or a description of what you are looking for."),
        limit: z.number().int().min(1).max(50).optional().describe("Default 10."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ query, limit }) =>
      run(async () => {
        const hits = await semanticSearch(query, limit ?? 10);
        if (hits === null) {
          const status = semanticStatus();
          const detail = status.state === "indexing" ? ` (${status.done} of ${status.total} notes indexed)` : "";
          return { isError: true, content: [{ type: "text", text: `Semantic search is still preparing${detail}; try again shortly, or use search_notes.` }] };
        }
        if (!hits.length && semanticStatus().state === "off") {
          return { isError: true, content: [{ type: "text", text: "Semantic search is turned off in the app's settings." }] };
        }
        return text(hits.map((h) => ({ title: h.title, modified: new Date(h.mtime).toISOString(), score: Number(h.score.toFixed(3)), passage: h.passage })));
      }),
  );

  server.registerTool(
    "list_tags",
    { title: "List tags", description: "Every tag used in the notes.", annotations: { readOnlyHint: true } },
    () => run(async () => text(await allTags())),
  );

  server.registerTool(
    "list_folders",
    {
      title: "List folders",
      description: "Every folder, with how many notes it holds directly.",
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => {
        const notes = await listNotes();
        return text(
          (await listFolders()).map((folder) => ({ folder, notes: notes.filter((n) => parentFolder(n.title) === folder).length })),
        );
      }),
  );

  server.registerTool(
    "list_templates",
    {
      title: "List templates",
      description: `The notes in the templates folder, usable with create_note's template. Variables: {{title}}, {{date}}, {{time}}, {{datetime}}, {{date:YYYY-MM-DD HH:mm}}.`,
      annotations: { readOnlyHint: true },
    },
    () => run(async () => text((await listTemplates()).map((t) => ({ template: t.name, path: t.title })))),
  );

  if (readOnly || getSettings().mcpReadOnly) return server;

  const now = (value?: string) => {
    if (value === undefined) return localTime();
    const parsed = parseLocalTime(value);
    if (!parsed) throw new NoteError("local_time must look like 2026-11-13T09:30:00.", 400);
    return parsed;
  };

  server.registerTool(
    "create_note",
    {
      title: "Create a note",
      description:
        "Creates a new note, in a folder when the title has a path (folders are made as needed). Fails if the note already exists. " +
        "With `template`, starts from that template (see list_templates) and appends `content` after it.",
      inputSchema: {
        title: z.string().describe('The path, e.g. "Work/Weekly". Names can\'t hold \\ < > : " | ? * or start with a dot.'),
        content: z.string().optional().describe("Markdown body."),
        template: z.string().optional().describe("A template name from list_templates."),
        local_time: z.string().optional().describe("Your local time for template dates, YYYY-MM-DDTHH:mm:ss. Default: the server's."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    ({ title, content, template, local_time }) =>
      run(async () => {
        let body = content ?? "";
        if (template) {
          const found = (await listTemplates()).find((t) => t.name === template || t.title === template);
          if (!found) throw new NoteError(`No template named “${template}”.`, 404);
          const filled = applyTemplate(found.content, { title: noteName(title), now: now(local_time) });
          body = content ? `${filled.replace(/\s*$/, "")}\n\n${content}` : filled;
        }
        return text({ created: noteSummary(await createNote(title, body)) });
      }),
  );

  server.registerTool(
    "daily_note",
    {
      title: "Today's note",
      description: "Opens today's daily note (creating it from the daily template the first time) and optionally appends to it. Returns its Markdown.",
      inputSchema: {
        append: z.string().optional().describe("Markdown to add at the end, e.g. a log line."),
        local_time: z.string().optional().describe("Your local time, YYYY-MM-DDTHH:mm:ss, so 'today' is your day. Default: the server's."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    ({ append, local_time }) =>
      run(async () => {
        let { note } = await openDaily(now(local_time));
        if (append) {
          const separator = note.content.trim() ? (note.content.endsWith("\n") ? "\n" : "\n\n") : "";
          note = await updateNote(note.title, { content: note.content + separator + append, baseMtime: note.mtime });
        }
        return { content: [{ type: "text", text: JSON.stringify(noteSummary(note), null, 2) }, { type: "text", text: note.content }] };
      }),
  );

  server.registerTool(
    "create_folder",
    {
      title: "Create a folder",
      description: "Makes an empty folder (nested paths allowed). Not needed before create_note, which makes folders itself.",
      inputSchema: { folder: z.string().describe('e.g. "Work/2027".') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    ({ folder }) => run(async () => text({ created: await createFolder(folder) })),
  );

  server.registerTool(
    "update_note",
    {
      title: "Update a note",
      description:
        "Replaces a note's content and/or renames it; a new_title with another folder moves it. Pass expected_modified_ms (from read_note) to refuse the write if the note changed since you read it.",
      inputSchema: {
        title: z.string().describe("Current path."),
        content: z.string().optional().describe("New full Markdown body. Omit to keep it."),
        new_title: z.string().optional().describe('Rename or move to this path, e.g. "Archive/Weekly".'),
        expected_modified_ms: z.number().optional().describe("modified_ms from read_note; conflict if it no longer matches."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    ({ title, content, new_title, expected_modified_ms }) =>
      run(async () => {
        const note = await updateNote(title, { content, newTitle: new_title, baseMtime: expected_modified_ms });
        return text({ updated: noteSummary(note) });
      }),
  );

  server.registerTool(
    "append_to_note",
    {
      title: "Append to a note",
      description: "Adds Markdown at the end of an existing note (on a new paragraph). Safe against concurrent edits.",
      inputSchema: { title: z.string(), text: z.string().describe("Markdown to append.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    ({ title, text: addition }) =>
      run(async () => {
        const note = await getNote(title);
        const separator = note.content.trim() ? (note.content.endsWith("\n") ? "\n" : "\n\n") : "";
        const updated = await updateNote(title, { content: note.content + separator + addition, baseMtime: note.mtime });
        return text({ updated: noteSummary(updated) });
      }),
  );

  server.registerTool(
    "delete_note",
    {
      title: "Delete a note",
      description: "Moves a note to the trash; it can be restored from the app's settings.",
      inputSchema: { title: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    ({ title }) =>
      run(async () => {
        await deleteNote(title);
        return text({ deleted: title });
      }),
  );

  return server;
}
