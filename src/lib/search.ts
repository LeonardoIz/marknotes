import MiniSearch from "minisearch";
import { listNotes, notePath, readText } from "./notes";
import { extractLinks, extractTags, fold, linkResolver, noteName, plainText, type LinkResolver } from "./parse";

type Doc = { id: string; title: string; text: string; tags: string[]; links: string[]; mtime: number };
export type SortKey = "score" | "title" | "modified";
export type SearchHit = { title: string; titleHtml: string; mtime: number; snippet: string | null; tags: string[] };

// One index per server process, kept across HMR reloads in dev.
const g = globalThis as unknown as { __notesIndex?: { docs: Map<string, Doc>; mini: MiniSearch<Doc> } };
const state = (g.__notesIndex ??= {
  docs: new Map<string, Doc>(),
  mini: new MiniSearch<Doc>({
    fields: ["title", "text", "tags"],
    extractField: (doc, field) => (field === "tags" ? doc.tags.join(" ") : String(doc[field as keyof Doc])),
    processTerm: (term) => fold(term),
    searchOptions: { boost: { title: 3, tags: 2 }, prefix: true, fuzzy: 0.2, combineWith: "AND" },
  }),
});

let syncing: Promise<void> | null = null;

/**
 * Bring the in-memory index up to date with the folder. Files edited outside the app are
 * picked up here by mtime; one unreadable file is skipped instead of breaking search.
 * shortcut: stats every file per call; fine for a few thousand notes, add a fs watcher beyond that.
 */
export function syncIndex(): Promise<void> {
  syncing ??= (async () => {
    try {
      const seen = new Set<string>();
      for (const { title, mtime } of await listNotes()) {
        seen.add(title);
        const current = state.docs.get(title);
        if (current?.mtime === mtime) continue;
        try {
          const content = await readText(notePath(title));
          const doc: Doc = {
            id: title,
            title,
            text: plainText(content, title),
            tags: extractTags(content),
            links: extractLinks(content),
            mtime,
          };
          if (current) state.mini.replace(doc);
          else state.mini.add(doc);
          state.docs.set(title, doc);
        } catch (error) {
          console.error(`[marknotes] could not index "${title}":`, error);
        }
      }
      for (const title of state.docs.keys()) {
        if (!seen.has(title)) {
          state.mini.discard(title);
          state.docs.delete(title);
        }
      }
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The text HTML-escaped, with every match of the (folded) terms wrapped in <mark>. */
function highlight(text: string, terms: string[]): string {
  if (!terms.length) return escapeHtml(text);
  const pattern = new RegExp(terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
  let html = "";
  let last = 0;
  // NFD fold keeps 1:1 positions only for precomposed input; good enough for a preview.
  for (const m of fold(text).matchAll(pattern)) {
    html += escapeHtml(text.slice(last, m.index)) + `<mark>${escapeHtml(text.slice(m.index, m.index + m[0].length))}</mark>`;
    last = m.index + m[0].length;
  }
  return html + escapeHtml(text.slice(last));
}

/** ~160 chars around the first match, highlighted. */
function snippet(text: string, terms: string[]): string | null {
  if (!terms.length || !text) return null;
  const folded = fold(text);
  let first = -1;
  for (const term of terms) {
    const i = folded.indexOf(term);
    if (i !== -1 && (first === -1 || i < first)) first = i;
  }
  if (first === -1) return null;
  const start = Math.max(0, first - 60);
  return (start > 0 ? "…" : "") + highlight(text.slice(start, start + 160), terms) + (start + 160 < text.length ? "…" : "");
}

/** `#tag` tokens filter by tag, the rest is full-text. Empty query or `*` lists everything. */
export async function search(query: string, sort: SortKey = "score", limit?: number): Promise<SearchHit[]> {
  await syncIndex();
  const tagFilter = [...query.matchAll(/(?<=^|\s)#(\S+)/g)].map((m) => m[1].toLowerCase());
  const text = query.replace(/(?<=^|\s)#\S+/g, "").replace(/^\s*\*\s*$/, "").trim();

  let hits: { doc: Doc; score: number; terms: string[] }[];
  if (text) {
    hits = state.mini.search(text).map((r) => ({ doc: state.docs.get(r.id)!, score: r.score, terms: r.terms }));
  } else {
    hits = [...state.docs.values()].map((doc) => ({ doc, score: 0, terms: [] }));
    if (sort === "score") sort = "modified";
  }
  if (tagFilter.length) {
    hits = hits.filter(({ doc }) => tagFilter.every((t) => doc.tags.some((tag) => tag === t || tag.startsWith(`${t}/`))));
  }

  if (sort === "title") hits.sort((a, b) => a.doc.title.localeCompare(b.doc.title, undefined, { sensitivity: "base" }));
  else if (sort === "modified") hits.sort((a, b) => b.doc.mtime - a.doc.mtime);
  else hits.sort((a, b) => b.score - a.score);

  return hits.slice(0, limit).map(({ doc, terms }) => ({
    title: doc.title,
    // Lists show the name, with its folder beside it in quieter type.
    titleHtml: highlight(noteName(doc.title), terms),
    mtime: doc.mtime,
    snippet: snippet(doc.text, terms),
    tags: doc.tags,
  }));
}

export async function allTags(): Promise<string[]> {
  await syncIndex();
  return [...new Set([...state.docs.values()].flatMap((d) => d.tags))].sort();
}

export async function allTitles(): Promise<string[]> {
  await syncIndex();
  return [...state.docs.keys()];
}

/** Resolves [[links]] against the notes as they are now. */
export async function resolver(): Promise<LinkResolver> {
  return linkResolver(await allTitles());
}

/** The notes whose [[links]] lead to this one (by path or by name, as the renderer resolves them). */
export async function backlinks(title: string): Promise<string[]> {
  const resolve = await resolver();
  const target = fold(title);
  return [...state.docs.values()]
    // A link to a missing note still counts by its text, so "Not written yet" can list who asks for it.
    .filter((d) => d.title !== title && d.links.some((l) => resolve(l, d.title) === title || fold(l.trim()) === target))
    .map((d) => d.title)
    .sort((a, b) => a.localeCompare(b));
}
