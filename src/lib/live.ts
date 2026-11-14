import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

/** A note changed on disk: written (`mtime`), or gone (`mtime: null`). `title: null` means folders changed. */
export type Change = { title: string | null; mtime: number | null };
type Listener = (change: Change) => void;

const g = globalThis as unknown as { __notesLive?: { listeners: Set<Listener>; watcher: fs.FSWatcher | null } };
const state = (g.__notesLive ??= { listeners: new Set(), watcher: null });
const pending = new Map<string, NodeJS.Timeout>();

/** `Work/Weekly.md` → its change; null for what isn't a note (dotfiles, temp files, attachments). */
function toNote(file: string): string | null | undefined {
  const parts = file.split(path.sep);
  if (parts.some((p) => p.startsWith(".")) || parts[0] === "attachments") return undefined;
  return file.endsWith(".md") ? parts.join("/").slice(0, -3) : null;
}

function emit(file: string) {
  const title = toNote(file);
  if (title === undefined) return;
  const key = title ?? "\0tree";
  clearTimeout(pending.get(key));
  // Editors and our own atomic writes touch a file a few times in a row; report it once, settled.
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      let mtime: number | null = null;
      if (title !== null) {
        try {
          mtime = fs.statSync(path.join(config.notesPath, file)).mtimeMs;
        } catch {}
      }
      for (const listener of state.listeners) listener({ title, mtime });
    }, 150),
  );
}

function ensureWatcher() {
  if (state.watcher) return;
  try {
    fs.mkdirSync(config.notesPath, { recursive: true });
    state.watcher = fs.watch(config.notesPath, { recursive: true }, (_event, filename) => filename && emit(String(filename)));
    state.watcher.on("error", (error) => {
      console.error("[marknotes] file watcher stopped:", error);
      state.watcher?.close();
      state.watcher = null;
    });
  } catch (error) {
    console.error("[marknotes] could not watch the notes folder; live updates are off:", error);
  }
}

/** Calls `listener` for every change to the notes on disk, from the app, an editor, sync or an agent. */
export function subscribe(listener: Listener): () => void {
  ensureWatcher();
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}
