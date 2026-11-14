import { noteName } from "./parse";
import { escapeHtml, search, type SearchHit, type SortKey } from "./search";
import { semanticSearch, semanticStatus } from "./semantic";

/** Whether meaning is part of the results: in, still getting ready, or turned off (or not asked: a short query). */
export type MeaningState = "in" | "preparing" | "off";

const TAGS = /(?<=^|\s)#\S+/g;
// Reciprocal rank fusion: each list adds 1/(K + rank). K=60 is the usual constant: it keeps one list's #1 from swamping the other.
const K = 60;
// A note found only by meaning must be this close: below it, the model's "closest" note is often noise
// (measured: "zzzz" 0.82, "asdf qwer" 0.78; real matches 0.84 to 0.87). Found by words too, any closeness helps.
const MEANING_ALONE = 0.83;

/**
 * One search over words and meaning together. A note found both ways ranks first, then notes found
 * one way, by how high each list put them. `#tags` still filter everything. Meaning joins once the
 * query has a few letters and the model is ready; until then the words alone answer.
 */
export async function findNotes(query: string, sort: SortKey = "score", limit?: number): Promise<{ hits: SearchHit[]; meaning: MeaningState }> {
  const words = await search(query, "score");
  const text = query.replace(TAGS, " ").replace(/^\s*\*\s*$/, "").trim();
  const tags = query.match(TAGS)?.join(" ") ?? "";

  let meaning: MeaningState = "off";
  let related: Awaited<ReturnType<typeof semanticSearch>> = [];
  if (text.length >= 4) {
    related = await semanticSearch(text, 20);
    meaning = related === null ? "preparing" : semanticStatus().state === "off" ? "off" : "in";
  }

  const fused = new Map<string, { hit: SearchHit; score: number }>();
  words.forEach((hit, i) => fused.set(hit.title, { hit, score: 1 / (K + i + 1) }));
  if (related?.length) {
    // Every note's tags and dates, to fill in hits found only by meaning (and to apply #tag filters to them).
    const known = new Map((await search(tags, "modified")).map((h) => [h.title, h]));
    related.forEach((r, i) => {
      const add = 1 / (K + i + 1);
      const seen = fused.get(r.title);
      if (seen) return void (seen.score += add);
      const base = known.get(r.title);
      if (!base || r.score < MEANING_ALONE) return; // filtered out by a #tag, or too far to stand alone
      fused.set(r.title, {
        hit: { ...base, titleHtml: escapeHtml(noteName(r.title)), snippet: escapeHtml(r.passage) },
        score: add,
      });
    });
  }

  const list = [...fused.values()];
  if (sort === "title") list.sort((a, b) => a.hit.title.localeCompare(b.hit.title, undefined, { sensitivity: "base" }));
  else if (sort === "modified" || !text) list.sort((a, b) => b.hit.mtime - a.hit.mtime);
  else list.sort((a, b) => b.score - a.score);
  return { hits: list.slice(0, limit).map((x) => x.hit), meaning };
}
