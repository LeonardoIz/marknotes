import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { config } from "./config";

/**
 * The app's own state (settings, pins, saved views) in SQLite, next to the notes in a hidden
 * folder. Notes themselves stay plain files; deleting this database loses only preferences.
 */
const g = globalThis as unknown as { __notesDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (g.__notesDb) return g.__notesDb;
  const dir = path.join(config.notesPath, ".notes");
  fs.mkdirSync(dir, { recursive: true });
  const database = new DatabaseSync(path.join(dir, "notes.db"));
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pins (title TEXT PRIMARY KEY, pinned_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      query TEXT NOT NULL,
      sort TEXT NOT NULL DEFAULT 'score',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mcp_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      read_only INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS embeddings (
      title TEXT NOT NULL,
      chunk INTEGER NOT NULL,
      mtime REAL NOT NULL,
      model TEXT NOT NULL,
      text TEXT NOT NULL,
      vector BLOB NOT NULL,
      PRIMARY KEY (title, chunk)
    );
    -- Agents that signed in with OAuth (see oauth.ts): the apps, their one-minute codes, and what each was granted.
    CREATE TABLE IF NOT EXISTS oauth_clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      redirect_uris TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_codes (
      hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      challenge TEXT NOT NULL,
      read_only INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      read_only INTEGER NOT NULL,
      access_hash TEXT NOT NULL UNIQUE,
      access_expires INTEGER NOT NULL,
      refresh_hash TEXT NOT NULL UNIQUE,
      refresh_expires INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    );
  `);
  return (g.__notesDb = database);
}

/* ---------- Settings ---------- */

export const settingsSchema = z.object({
  homeRecentCount: z.number().int().min(0).max(50),
  homeShowPinned: z.boolean(),
  homeShowViews: z.boolean(),
  editorSpellcheck: z.boolean(),
  editorFont: z.enum(["sans", "mono"]),
  readingShowToc: z.boolean(),
  readingShowBacklinks: z.boolean(),
  readingInteractiveTasks: z.boolean(),
  trashRetentionDays: z.number().int().min(0).max(3650),
  mcpEnabled: z.boolean(),
  mcpReadOnly: z.boolean(),
  templatesFolder: z.string().trim().max(200),
  dailyFolder: z.string().trim().max(200),
  dailyFormat: z.string().trim().min(1).max(60),
  dailyTemplate: z.string().trim().max(200),
  semanticSearch: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = {
  homeRecentCount: 8,
  homeShowPinned: true,
  homeShowViews: true,
  editorSpellcheck: true,
  editorFont: "sans",
  readingShowToc: true,
  readingShowBacklinks: true,
  readingInteractiveTasks: true,
  trashRetentionDays: 30,
  mcpEnabled: false,
  mcpReadOnly: false,
  templatesFolder: "Templates",
  dailyFolder: "Daily",
  dailyFormat: "YYYY-MM-DD",
  dailyTemplate: "",
  semanticSearch: true,
};

export function getSettings(): Settings {
  const stored: Record<string, unknown> = {};
  for (const row of db().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[]) {
    try {
      stored[row.key] = JSON.parse(row.value);
    } catch {}
  }
  // Each stored value must still be valid on its own; a bad or retired one falls back to the default.
  const merged = { ...defaultSettings };
  for (const key of Object.keys(defaultSettings) as (keyof Settings)[]) {
    const parsed = settingsSchema.shape[key].safeParse(stored[key]);
    if (parsed.success) (merged as Record<string, unknown>)[key] = parsed.data;
  }
  return merged;
}

/** Validates and stores a partial update; unknown keys are rejected. Returns the full settings. */
export function updateSettings(patch: unknown): Settings {
  const changes = settingsSchema.partial().strict().parse(patch);
  const upsert = db().prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [key, value] of Object.entries(changes)) upsert.run(key, JSON.stringify(value));
  return getSettings();
}

/* ---------- Internal state: kept in the same table under keys the settings API never reads or writes ---------- */

export function getState<T>(key: string): T | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(`@${key}`) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : null;
}

export function setState(key: string, value: unknown) {
  if (value === null) return void db().prepare("DELETE FROM settings WHERE key = ?").run(`@${key}`);
  db()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(`@${key}`, JSON.stringify(value));
}

/* ---------- Pins ---------- */

export const listPins = (): string[] =>
  (db().prepare("SELECT title FROM pins ORDER BY pinned_at").all() as { title: string }[]).map((r) => r.title);

export const isPinned = (title: string) => !!db().prepare("SELECT 1 FROM pins WHERE title = ?").get(title);

export function setPinned(title: string, pinned: boolean) {
  if (pinned) db().prepare("INSERT OR IGNORE INTO pins (title, pinned_at) VALUES (?, ?)").run(title, Date.now());
  else db().prepare("DELETE FROM pins WHERE title = ?").run(title);
}

/** Keeps a pin attached to its note across a rename. */
export function renamePin(from: string, to: string) {
  db().prepare("UPDATE OR REPLACE pins SET title = ? WHERE title = ?").run(to, from);
}

/** Keeps pins inside a folder attached across the folder's rename. */
export function renamePinPrefix(from: string, to: string) {
  const rows = db().prepare("SELECT title FROM pins WHERE substr(title, 1, ?) = ?").all(from.length + 1, `${from}/`) as { title: string }[];
  for (const { title } of rows) renamePin(title, to + title.slice(from.length));
}

/* ---------- Saved views (named searches) ---------- */

export type View = { id: number; name: string; query: string; sort: "score" | "meaning" | "title" | "modified" };

export const viewInput = z.object({
  name: z.string().trim().min(1).max(80),
  query: z.string().trim().min(1).max(500),
  sort: z.enum(["score", "meaning", "title", "modified"]).default("score"),
});

// node:sqlite rows have a null prototype, which React refuses to pass to client components.
export const listViews = (): View[] =>
  (db().prepare("SELECT id, name, query, sort FROM views ORDER BY created_at").all() as View[]).map((row) => ({ ...row }));

export function createView(input: unknown): View {
  const { name, query, sort } = viewInput.parse(input);
  const { lastInsertRowid } = db()
    .prepare("INSERT INTO views (name, query, sort, created_at) VALUES (?, ?, ?, ?)")
    .run(name, query, sort, Date.now());
  return { id: Number(lastInsertRowid), name, query, sort };
}

export const deleteView = (id: number) => db().prepare("DELETE FROM views WHERE id = ?").run(id).changes > 0;

/* ---------- MCP tokens: one per agent, stored hashed, shown once ---------- */

export type McpToken = { id: number; name: string; readOnly: boolean; createdAt: number; lastUsedAt: number | null };
type TokenRow = { id: number; name: string; read_only: number; created_at: number; last_used_at: number | null };

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const toToken = (r: TokenRow): McpToken => ({ id: r.id, name: r.name, readOnly: !!r.read_only, createdAt: r.created_at, lastUsedAt: r.last_used_at });

export const tokenInput = z.object({ name: z.string().trim().min(1).max(80), readOnly: z.boolean().default(false) });

export const listMcpTokens = (): McpToken[] =>
  (db().prepare("SELECT id, name, read_only, created_at, last_used_at FROM mcp_tokens ORDER BY created_at").all() as TokenRow[]).map(toToken);

/** Returns the secret once; only its hash is kept. */
export function createMcpToken(input: unknown): McpToken & { token: string } {
  const { name, readOnly } = tokenInput.parse(input);
  const token = `notes_${randomBytes(24).toString("base64url")}`;
  const now = Date.now();
  const { lastInsertRowid } = db()
    .prepare("INSERT INTO mcp_tokens (name, hash, read_only, created_at) VALUES (?, ?, ?, ?)")
    .run(name, hashToken(token), readOnly ? 1 : 0, now);
  return { id: Number(lastInsertRowid), name, readOnly, createdAt: now, lastUsedAt: null, token };
}

/** The token's agent, if it is a live one (and notes when it was last used). */
export function findMcpToken(token: string): McpToken | null {
  if (!token) return null;
  // Looked up by hash: an index match on a digest leaks nothing useful about the secret.
  const row = db().prepare("SELECT id, name, read_only, created_at, last_used_at FROM mcp_tokens WHERE hash = ?").get(hashToken(token)) as
    | TokenRow
    | undefined;
  if (!row) return null;
  const now = Date.now();
  if (!row.last_used_at || now - row.last_used_at > 60_000) db().prepare("UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?").run(now, row.id);
  return toToken({ ...row, last_used_at: now });
}

export const deleteMcpToken = (id: number) => db().prepare("DELETE FROM mcp_tokens WHERE id = ?").run(id).changes > 0;

/* ---------- Embeddings for semantic search (a cache: deleting them only costs re-indexing) ---------- */

export type StoredChunk = { title: string; chunk: number; mtime: number; model: string; text: string; vector: Float32Array };
type ChunkRow = Omit<StoredChunk, "vector"> & { vector: Uint8Array };

const toVector = (bytes: Uint8Array) => new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

export const loadEmbeddings = (): StoredChunk[] =>
  (db().prepare("SELECT title, chunk, mtime, model, text, vector FROM embeddings").all() as ChunkRow[]).map((r) => ({ ...r, vector: toVector(r.vector) }));

/** Replaces a note's chunks in one go. */
export function saveEmbeddings(title: string, chunks: Omit<StoredChunk, "title" | "chunk">[]) {
  const database = db();
  const insert = database.prepare("INSERT INTO embeddings (title, chunk, mtime, model, text, vector) VALUES (?, ?, ?, ?, ?, ?)");
  database.exec("BEGIN");
  try {
    database.prepare("DELETE FROM embeddings WHERE title = ?").run(title);
    chunks.forEach((c, i) => insert.run(title, i, c.mtime, c.model, c.text, new Uint8Array(c.vector.buffer, c.vector.byteOffset, c.vector.byteLength)));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export const deleteEmbeddings = (title: string) => db().prepare("DELETE FROM embeddings WHERE title = ?").run(title);
