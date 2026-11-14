import path from "node:path";
import { config } from "./config";
import { deleteEmbeddings, getSettings, loadEmbeddings, saveEmbeddings, type StoredChunk } from "./db";
import { listNotes, notePath, readText } from "./notes";
import { noteName, plainText, splitFrontmatter } from "./parse";

/**
 * Search by meaning: every note is cut into passages, each turned into a vector by a small
 * multilingual model that runs on this machine (no service, nothing leaves the server). A query
 * is a vector too; the notes whose passages point the same way rank first.
 */

/** multilingual-e5-small: 384 dimensions, ~120 MB once downloaded, good across Spanish and English. */
export const MODEL = "Xenova/multilingual-e5-small";
export type Embedder = (texts: string[], kind: "query" | "passage") => Promise<Float32Array[]>;

export type SemanticStatus =
  | { state: "off" }
  | { state: "idle" } // not prepared yet: that happens on the first search by meaning
  | { state: "loading" } // downloading or opening the model
  | { state: "indexing"; done: number; total: number }
  | { state: "ready"; notes: number }
  | { state: "error"; message: string };

export type SemanticHit = { title: string; mtime: number; score: number; passage: string };

const g = globalThis as unknown as {
  __notesSemantic?: {
    embedder: Embedder | null;
    loading: Promise<Embedder> | null;
    chunks: StoredChunk[] | null; // in memory, loaded from SQLite once
    syncing: Promise<void> | null;
    status: SemanticStatus;
    model: string;
    ready: boolean; // a full index exists; later syncs only catch up on edits
  };
};
const state = (g.__notesSemantic ??= {
  embedder: null,
  loading: null,
  chunks: null,
  syncing: null,
  status: { state: "idle" },
  model: MODEL,
  ready: false,
});

/** For tests: a stand-in model. */
export function useEmbedder(embedder: Embedder, model = "test") {
  state.embedder = embedder;
  state.model = model;
  state.chunks = null;
  state.ready = false;
}

async function loadModel(): Promise<Embedder> {
  if (state.embedder) return state.embedder;
  state.loading ??= (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.cacheDir = path.join(config.notesPath, ".notes", "models");
    env.allowLocalModels = false;
    const extract = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
    const embedder: Embedder = async (texts, kind) => {
      // e5 models expect these prefixes; vectors come back normalized, so a dot product is the cosine.
      const output = await extract(texts.map((t) => `${kind}: ${t}`), { pooling: "mean", normalize: true });
      const [rows, dims] = output.dims as [number, number];
      const data = output.data as Float32Array;
      return Array.from({ length: rows }, (_, i) => data.slice(i * dims, (i + 1) * dims));
    };
    state.embedder = embedder;
    return embedder;
  })();
  try {
    return await state.loading;
  } catch (error) {
    state.loading = null;
    throw error;
  }
}

const MAX_CHUNK = 700;

/** A note as passages of up to ~700 characters, split on paragraphs (then sentences), each led by the note's name. */
export function chunkNote(title: string, markdown: string): string[] {
  const name = noteName(title);
  const blocks = splitFrontmatter(markdown)
    .body.split(/\n\s*\n/)
    .map((b) => plainText(b))
    .filter(Boolean);
  const pieces = blocks.flatMap((b) => (b.length <= MAX_CHUNK ? [b] : (b.match(/[^.!?]+[.!?]*\s*/g) ?? [b])));
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    for (let i = 0; i < piece.length; i += MAX_CHUNK) {
      const part = piece.slice(i, i + MAX_CHUNK).trim();
      if (current && current.length + part.length + 1 > MAX_CHUNK) {
        chunks.push(current);
        current = "";
      }
      current = current ? `${current} ${part}` : part;
    }
  }
  if (current) chunks.push(current);
  return (chunks.length ? chunks : [""]).map((c) => (c ? `${name}\n${c}` : name));
}

/** Brings the vectors up to date with the notes (by mtime), re-embedding only what changed. */
export function syncEmbeddings(): Promise<void> {
  state.syncing ??= (async () => {
    try {
      if (!getSettings().semanticSearch) {
        state.status = { state: "off" };
        return;
      }
      if (!state.embedder) state.status = { state: "loading" };
      const embed = await loadModel();
      state.chunks ??= loadEmbeddings().filter((c) => c.model === state.model);
      const notes = await listNotes();
      const stored = new Map<string, number>();
      for (const c of state.chunks) stored.set(c.title, c.mtime);
      const stale = notes.filter((n) => stored.get(n.title) !== n.mtime);
      const live = new Set(notes.map((n) => n.title));
      for (const title of stored.keys()) if (!live.has(title)) deleteEmbeddings(title);
      state.chunks = state.chunks.filter((c) => live.has(c.title));

      let done = 0;
      for (const note of stale) {
        if (!state.ready) state.status = { state: "indexing", done, total: stale.length };
        try {
          const texts = chunkNote(note.title, await readText(notePath(note.title)));
          const vectors: Float32Array[] = [];
          for (let i = 0; i < texts.length; i += 16) vectors.push(...(await embed(texts.slice(i, i + 16), "passage")));
          const chunks = texts.map((text, i) => ({ mtime: note.mtime, model: state.model, text, vector: vectors[i] }));
          saveEmbeddings(note.title, chunks);
          state.chunks = [...state.chunks.filter((c) => c.title !== note.title), ...chunks.map((c, i) => ({ ...c, title: note.title, chunk: i }))];
        } catch (error) {
          console.error(`[marknotes] could not embed "${note.title}":`, error);
        }
        done++;
      }
      state.status = { state: "ready", notes: notes.length };
      state.ready = true;
    } catch (error) {
      console.error("[marknotes] semantic search unavailable:", error);
      state.status = { state: "error", message: error instanceof Error ? error.message : String(error) };
    } finally {
      state.syncing = null;
    }
  })();
  return state.syncing;
}

export function semanticStatus(): SemanticStatus {
  if (!getSettings().semanticSearch) return { state: "off" };
  return state.status;
}

const dot = (a: Float32Array, b: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
};

/**
 * Notes ranked by how close their best passage is to the query. Scores from this model sit in a
 * narrow band (measured on real notes: ~0.78–0.82 unrelated, ~0.85+ related), so the cut is relative to
 * the best hit: within 0.025 of it.
 * Returns `null` while the model or the index isn't ready yet (preparation is started).
 */
export async function semanticSearch(query: string, limit = 20): Promise<SemanticHit[] | null> {
  if (!query.trim() || !getSettings().semanticSearch) return [];
  const sync = syncEmbeddings();
  // The first time (model download, full index) can take minutes: answer later instead of hanging.
  if (!state.ready) return null;
  await sync;
  const [q] = await (await loadModel())([query.trim()], "query");
  const best = new Map<string, { score: number; passage: string }>();
  for (const c of state.chunks ?? []) {
    const score = dot(q, c.vector);
    if (score > (best.get(c.title)?.score ?? -Infinity)) best.set(c.title, { score, passage: c.text });
  }
  const mtimes = new Map((await listNotes()).map((n) => [n.title, n.mtime]));
  const ranked = [...best.entries()].filter(([t]) => mtimes.has(t)).sort((a, b) => b[1].score - a[1].score);
  const top = ranked[0]?.[1].score ?? 0;
  return ranked
    .filter(([, h]) => h.score >= top - 0.025 && h.score >= 0.8)
    .slice(0, limit)
    .map(([title, h]) => ({
      title,
      mtime: mtimes.get(title)!,
      score: h.score,
      passage: h.passage.slice(h.passage.indexOf("\n") + 1).slice(0, 220),
    }));
}
