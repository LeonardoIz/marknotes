import { parse as parseYaml } from "yaml";

/** Pure text helpers shared by the index and the renderer (no Node APIs, safe to unit test). */

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const CODE = /^(```|~~~)[\s\S]*?^\1|`[^`\n]*`/gm;
// `#tag` at the start or after whitespace; Unicode letters; pure numbers (#1) are not tags.
const TAG = /(?<=^|\s)#([\p{L}\p{N}_/-]*[\p{L}_][\p{L}\p{N}_/-]*)/gu;
export const WIKILINK = /\[\[([^[\]|#\n]+)(#[^[\]|\n]*)?(?:\|([^[\]\n]+))?\]\]/g;

export function splitFrontmatter(markdown: string): { data: Record<string, unknown>; body: string } {
  const match = FRONTMATTER.exec(markdown);
  if (!match) return { data: {}, body: markdown };
  try {
    const data = parseYaml(match[1]);
    return { data: data && typeof data === "object" ? data : {}, body: markdown.slice(match[0].length) };
  } catch {
    return { data: {}, body: markdown.slice(match[0].length) };
  }
}

export function extractTags(markdown: string): string[] {
  const { data, body } = splitFrontmatter(markdown);
  const tags = new Set<string>();
  const fm = data.tags;
  const fmTags = Array.isArray(fm) ? fm : typeof fm === "string" ? fm.split(/[,\s]+/) : [];
  for (const tag of fmTags) if (String(tag).trim()) tags.add(String(tag).trim().replace(/^#/, "").toLowerCase());
  for (const match of body.replace(CODE, "").matchAll(TAG)) tags.add(match[1].toLowerCase());
  return [...tags].sort();
}

export function extractLinks(markdown: string): string[] {
  const body = splitFrontmatter(markdown).body.replace(CODE, "");
  return [...new Set([...body.matchAll(WIKILINK)].map((m) => m[1].trim()))];
}

/** Rough markdown → text for search snippets. */
/** Markdown as searchable prose. A leading "# Title" repeating the note's title is dropped, as the reader does. */
export function plainText(markdown: string, title?: string): string {
  let { body } = splitFrontmatter(markdown);
  const h1 = /^\s*#\s+(.+?)\s*#*\s*$/m.exec(body);
  if (title && h1 && !body.slice(0, h1.index).trim() && fold(h1[1]) === fold(title)) body = body.slice(h1.index + h1[0].length);
  return body
    .replace(/^(```|~~~).*$/gm, "")
    .replace(WIKILINK, (_, target: string, _h, alias?: string) => alias ?? target)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?(\[!\w+\])?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, "")
    .replace(/[*~`]+|(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, "") // keeps snake_case words intact
    .replace(/\s+/g, " ")
    .trim();
}

export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** A CSS-ident-safe view-transition name for a note title (titles can hold any character). */
export function noteTransitionName(title: string): string {
  let h = 5381;
  for (const c of fold(title)) h = ((h << 5) + h + c.codePointAt(0)!) | 0;
  return `note-${(h >>> 0).toString(36)}`;
}

/* ---------- Note paths (`Folder/Sub/Name`) ---------- */

/** The note's own name, without its folders. */
export const noteName = (title: string) => title.slice(title.lastIndexOf("/") + 1);
/** The folder a note (or folder) is in, "" at the top. */
export const parentFolder = (title: string) => (title.includes("/") ? title.slice(0, title.lastIndexOf("/")) : "");
const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");
export const noteHref = (title: string) => `/note/${encodePath(title)}`;
export const folderHref = (folder: string) => (folder ? `/notes/${encodePath(folder)}` : "/notes");
export const noteApi = (title: string) => `/api/notes/${encodePath(title)}`;

export type LinkResolver = (target: string, from?: string) => string | null;

/**
 * How `[[target]]` finds its note: the exact path first, then any note whose path ends with it
 * (`[[Weekly]]` or `[[Work/Weekly]]` → `Work/Weekly`), preferring the linking note's own folder,
 * then the shallowest. Case and accents don't matter. Null when nothing matches.
 */
export function linkResolver(titles: Iterable<string>): LinkResolver {
  const exact = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const title of titles) {
    exact.set(fold(title), title);
    const key = fold(noteName(title));
    byName.set(key, [...(byName.get(key) ?? []), title]);
  }
  return (target, from) => {
    const t = fold(target.trim().replace(/^\/+|\/+$/g, ""));
    if (!t) return null;
    const hit = exact.get(t);
    if (hit) return hit;
    const candidates = (byName.get(noteName(t)) ?? []).filter((c) => fold(c).endsWith(`/${t}`));
    if (!candidates.length) return null;
    const here = from ? parentFolder(from) : "";
    return candidates.sort(
      (a, b) =>
        Number(parentFolder(b) === here) - Number(parentFolder(a) === here) ||
        a.split("/").length - b.split("/").length ||
        a.localeCompare(b),
    )[0];
  };
}
