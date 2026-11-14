import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { renamePin, renamePinPrefix, setPinned } from "./db";

export class NoteError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 | 413,
  ) {
    super(message);
  }
}

/** `title` is the note's path inside the notes folder, without `.md`: `Work/Weekly` is `Work/Weekly.md`. */
export type NoteMeta = { title: string; mtime: number };
export type Note = NoteMeta & { content: string };

const EXT = ".md";
// Windows-reserved characters too, so the folder stays portable.
const INVALID_CHARS = /[\\/<>:"|?*\u0000-\u001f]/;
const decoder = new TextDecoder("utf-8"); // non-fatal: bad bytes become U+FFFD instead of crashing

const root = () => config.notesPath;
const attachmentsDir = () => path.join(root(), "attachments");
const trashDir = () => path.join(root(), ".trash");

// What can never be part of a note's file name here: a path separator or a control character.
const UNSAFE_CHARS = /[/\u0000-\u001f]/;

const MAX_DEPTH = 8;

/** One folder or file name. Same rules as a title: portable when new, as-is when it already exists. */
function validateName(raw: string, existing: boolean, what: string): string {
  const name = existing ? raw : raw.trim();
  if (!name.trim()) throw new NoteError(`The ${what} cannot be empty.`, 400);
  if (existing ? UNSAFE_CHARS.test(name) : INVALID_CHARS.test(name)) {
    throw new NoteError(`The ${what} cannot contain \\ < > : " | ? * or control characters.`, 400);
  }
  if (name.startsWith(".")) throw new NoteError(`The ${what} cannot start with a dot.`, 400);
  if (Buffer.byteLength(name + EXT) > 255) throw new NoteError(`The ${what} is too long.`, 400);
  return name;
}

/** `Folder/Sub/Name` → its segments; `attachments/` at the top is the app's, not a folder of notes. */
function validatePath(raw: unknown, existing: boolean, what: string): string {
  const parts = (typeof raw === "string" ? raw : "").split("/");
  if (!existing) {
    // Typed paths are forgiving about stray slashes: " Work / Weekly/ " is "Work/Weekly".
    while (parts.length > 1 && !parts[0].trim()) parts.shift();
    while (parts.length > 1 && !parts[parts.length - 1].trim()) parts.pop();
  }
  if (parts.length > MAX_DEPTH) throw new NoteError(`Folders can only nest ${MAX_DEPTH - 1} deep.`, 400);
  const names = parts.map((p, i) => validateName(p, existing, i === parts.length - 1 ? what : "folder name"));
  if (names.length > 1 && names[0].toLowerCase() === "attachments") {
    throw new NoteError("“attachments” is reserved for uploaded files.", 400);
  }
  return names.join("/");
}

/**
 * New titles (create, rename) must be portable, so Windows-reserved characters are refused.
 * An existing note is only looked up: files made outside the app may use any name the OS allows
 * (`Receta: pan.md`), so then only what could escape the folder is refused, and the name is kept as is.
 * A `/` puts the note in a folder.
 */
export function validateTitle(raw: unknown, { existing = false }: { existing?: boolean } = {}): string {
  return validatePath(raw, existing, "title");
}

export function validateFolder(raw: unknown, { existing = false }: { existing?: boolean } = {}): string {
  return validatePath(raw, existing, "folder name");
}

export const notePath = (title: string) => path.join(root(), ...validateTitle(title, { existing: true }).split("/")) + EXT;
const folderPath = (folder: string) => path.join(root(), ...validateFolder(folder, { existing: true }).split("/"));

/** Removes the folders a move or delete left empty, up to (never including) the notes folder. */
async function pruneEmptyDirs(from: string) {
  let dir = path.dirname(from);
  while (dir.startsWith(root() + path.sep)) {
    try {
      await fs.rmdir(dir);
    } catch {
      return; // not empty (or gone)
    }
    dir = path.dirname(dir);
  }
}

export async function readText(file: string): Promise<string> {
  return decoder.decode(await fs.readFile(file)).replace(/^﻿/, "");
}

/** Write via a temp file + rename so a crash never leaves a half-written note. */
async function writeAtomic(file: string, content: string, { overwrite }: { overwrite: boolean }) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(4).toString("hex")}.tmp`);
  const handle = await fs.open(tmp, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (overwrite) {
      await fs.rename(tmp, file);
    } else {
      await fs.link(tmp, file); // fails with EEXIST instead of overwriting
      await fs.unlink(tmp);
    }
  } catch (error) {
    await fs.rm(tmp, { force: true });
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new NoteError("A note with this title already exists.", 409);
    }
    throw error;
  }
}

async function statOrNull(file: string) {
  try {
    return await fs.stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function ensureDirs() {
  await fs.mkdir(attachmentsDir(), { recursive: true });
}

/** Every note and every folder (empty ones too), walking the tree; dot-folders and attachments/ are skipped. */
async function walk(): Promise<{ notes: NoteMeta[]; folders: string[] }> {
  await ensureDirs();
  const notes: NoteMeta[] = [];
  const folders: string[] = [];
  const visit = async (dir: string, prefix: string, depth: number) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // removed while walking
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || UNSAFE_CHARS.test(entry.name)) continue;
      if (entry.isDirectory()) {
        if (depth === 0 && entry.name === "attachments") continue;
        if (depth + 1 >= MAX_DEPTH) continue;
        folders.push(prefix + entry.name);
        await visit(path.join(dir, entry.name), `${prefix}${entry.name}/`, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(EXT)) {
        const stat = await statOrNull(path.join(dir, entry.name));
        if (stat) notes.push({ title: prefix + entry.name.slice(0, -EXT.length), mtime: stat.mtimeMs });
      }
    }
  };
  await visit(root(), "", 0);
  return { notes, folders };
}

export async function listNotes(): Promise<NoteMeta[]> {
  return (await walk()).notes;
}

/** Every folder path, sorted, empty ones included. */
export async function listFolders(): Promise<string[]> {
  return (await walk()).folders.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export async function createFolder(raw: unknown): Promise<string> {
  const folder = validateFolder(raw);
  const dir = folderPath(folder);
  if (await statOrNull(dir)) throw new NoteError("That folder already exists.", 409);
  await fs.mkdir(dir, { recursive: true });
  return folder;
}

/** Renames or moves a folder with everything in it; pins follow. Refuses to overwrite. */
export async function renameFolder(from: string, rawTo: unknown): Promise<string> {
  const source = folderPath(from);
  if (!(await statOrNull(source))?.isDirectory()) throw new NoteError("Folder not found.", 404);
  const to = validateFolder(rawTo);
  if (to === from) return to;
  if ((to + "/").startsWith(from + "/")) throw new NoteError("A folder can't move inside itself.", 400);
  const target = folderPath(to);
  const existing = await statOrNull(target);
  if (existing && existing.ino !== (await fs.stat(source)).ino) throw new NoteError("A folder with that name already exists.", 409);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(source, target);
  await pruneEmptyDirs(source);
  renamePinPrefix(from, to);
  return to;
}

/** Only an empty folder can be deleted; notes are deleted (to the trash) one by one. */
export async function deleteFolder(folder: string): Promise<void> {
  const dir = folderPath(folder);
  if (!(await statOrNull(dir))?.isDirectory()) throw new NoteError("Folder not found.", 404);
  try {
    await fs.rmdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOTEMPTY") throw new NoteError("Only an empty folder can be deleted.", 409);
    throw error;
  }
}

export async function getNote(title: string): Promise<Note> {
  const file = notePath(title);
  const stat = await statOrNull(file);
  if (!stat) throw new NoteError("Note not found.", 404);
  return { title, content: await readText(file), mtime: stat.mtimeMs };
}

export async function createNote(rawTitle: unknown, content: unknown): Promise<Note> {
  const title = validateTitle(rawTitle);
  await ensureDirs();
  const file = notePath(title);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeAtomic(file, typeof content === "string" ? content : "", { overwrite: false });
  return getNote(title);
}

export async function updateNote(
  title: string,
  changes: { newTitle?: unknown; content?: unknown; baseMtime?: unknown },
): Promise<Note> {
  const file = notePath(title);
  const stat = await statOrNull(file);
  if (!stat) throw new NoteError("Note not found.", 404);

  // Optimistic concurrency: refuse to overwrite edits made elsewhere since the client loaded the note.
  if (typeof changes.baseMtime === "number" && changes.baseMtime !== stat.mtimeMs) {
    throw new NoteError("This note was changed somewhere else since you opened it.", 409);
  }

  let target = file;
  let finalTitle = title;
  if (changes.newTitle !== undefined && changes.newTitle !== title) {
    finalTitle = validateTitle(changes.newTitle);
    target = notePath(finalTitle);
    const existing = await statOrNull(target);
    // Same inode = case-only rename on a case-insensitive filesystem.
    if (existing && existing.ino !== stat.ino) {
      throw new NoteError("A note with this title already exists.", 409);
    }
  }

  if (typeof changes.content === "string") await writeAtomic(file, changes.content, { overwrite: true });
  if (target !== file) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(file, target);
    await pruneEmptyDirs(file);
    renamePin(title, finalTitle);
  }
  return getNote(finalTitle);
}

/** Deleted notes go to .trash/ instead of disappearing. */
export async function deleteNote(title: string): Promise<void> {
  const file = notePath(title);
  if (!(await statOrNull(file))) throw new NoteError("Note not found.", 404);
  await fs.mkdir(trashDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.rename(file, path.join(trashDir(), `${encodeTrashTitle(title)} ${stamp}${EXT}`));
  await pruneEmptyDirs(file);
  setPinned(title, false);
}

// Trash: `<title> <ISO stamp with - for : and .>.md` in .trash/, flat: a folder's `/` is kept as %2F (and % as %25).
const encodeTrashTitle = (title: string) => title.replace(/%/g, "%25").replace(/\//g, "%2F");
const decodeTrashTitle = (name: string) => name.replace(/%2F/gi, "/").replace(/%25/g, "%");

const TRASH_NAME = /^(.+) (\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.md$/;
export type TrashItem = { name: string; title: string; deletedAt: number; size: number };

function parseTrashName(name: string): { title: string; deletedAt: number } {
  const m = TRASH_NAME.exec(name);
  if (!m) return { title: decodeTrashTitle(name.replace(/\.md$/, "")), deletedAt: 0 };
  const [date, time] = m[2].split("T");
  const [h, min, sec, ms] = time.replace("Z", "").split("-");
  return { title: decodeTrashTitle(m[1]), deletedAt: Date.parse(`${date}T${h}:${min}:${sec}.${ms}Z`) };
}

/** A file in .trash/, by its exact name; anything else (paths, dotfiles) is refused. */
function trashPath(name: string): string {
  if (!name || name !== path.basename(name) || name.startsWith(".") || !name.endsWith(EXT)) {
    throw new NoteError("Invalid trash item.", 400);
  }
  return path.join(trashDir(), name);
}

export async function listTrash(): Promise<TrashItem[]> {
  let names: string[];
  try {
    names = await fs.readdir(trashDir());
  } catch {
    return [];
  }
  const items: TrashItem[] = [];
  for (const name of names) {
    if (name.startsWith(".") || !name.endsWith(EXT)) continue;
    const stat = await statOrNull(path.join(trashDir(), name));
    if (!stat?.isFile()) continue;
    const { title, deletedAt } = parseTrashName(name);
    items.push({ name, title, size: stat.size, deletedAt: deletedAt || stat.mtimeMs });
  }
  return items.sort((a, b) => b.deletedAt - a.deletedAt);
}

/** Puts a deleted note back. If its title is taken meanwhile, it comes back as "<title> (restored)". */
export async function restoreFromTrash(name: string): Promise<string> {
  const from = trashPath(name);
  if (!(await statOrNull(from))) throw new NoteError("Not in the trash.", 404);
  const { title } = parseTrashName(name);
  for (let n = 1; n < 100; n++) {
    const candidate = validateTitle(n === 1 ? title : `${title} (restored${n > 2 ? ` ${n - 1}` : ""})`, { existing: true });
    try {
      await fs.mkdir(path.dirname(notePath(candidate)), { recursive: true });
      await fs.link(from, notePath(candidate)); // fails instead of overwriting a note
      await fs.unlink(from);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new NoteError("Could not find a free title to restore to.", 409);
}

export async function deleteFromTrash(name: string): Promise<void> {
  try {
    await fs.unlink(trashPath(name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new NoteError("Not in the trash.", 404);
    throw error;
  }
}

/** Deletes trash older than `days` (all of it with 0 when `all`). Returns how many went. */
export async function purgeTrash({ olderThanDays, all = false }: { olderThanDays?: number; all?: boolean }): Promise<number> {
  const cutoff = Date.now() - (olderThanDays ?? 0) * 86_400_000;
  let count = 0;
  for (const item of await listTrash()) {
    if (all || (olderThanDays && item.deletedAt < cutoff)) {
      await fs.rm(path.join(trashDir(), item.name), { force: true });
      count++;
    }
  }
  return count;
}

// Attachments

function cleanFilename(raw: string): string {
  const name = path.basename(raw).replace(INVALID_CHARS, "_").replace(/^\.+/, "").trim();
  if (!name) throw new NoteError("Invalid filename.", 400);
  if (Buffer.byteLength(name) > 200) throw new NoteError("The filename is too long.", 400);
  return name;
}

export async function saveAttachment(rawName: string, data: Uint8Array): Promise<string> {
  if (data.byteLength > config.maxUploadBytes) throw new NoteError("The file is too large.", 413);
  await ensureDirs();
  let name = cleanFilename(rawName);
  if (await statOrNull(path.join(attachmentsDir(), name))) {
    const ext = path.extname(name);
    name = `${name.slice(0, name.length - ext.length)}-${Date.now()}${ext}`;
  }
  await fs.writeFile(path.join(attachmentsDir(), name), data, { flag: "wx" });
  return name;
}

/** An attachment's path and size, for streaming it; only plain names inside attachments/. */
export async function statAttachment(rawName: string): Promise<{ name: string; file: string; size: number }> {
  const name = cleanFilename(rawName);
  if (name !== rawName) throw new NoteError("Invalid filename.", 400);
  const file = path.join(attachmentsDir(), name);
  const stat = await statOrNull(file);
  if (!stat?.isFile()) throw new NoteError("Attachment not found.", 404);
  return { name, file, size: stat.size };
}

export type AttachmentInfo = { name: string; size: number; mtime: number; usedBy: string[] };

/** Every attachment, with the notes that reference it (by `attachments/<name>`, raw or URL-encoded). */
export async function listAttachments(): Promise<AttachmentInfo[]> {
  await ensureDirs();
  const notes = await Promise.all(
    (await listNotes()).map(async (n) => ({
      title: n.title,
      content: await readText(notePath(n.title)).catch(() => ""),
    })),
  );
  const items: AttachmentInfo[] = [];
  for (const name of await fs.readdir(attachmentsDir())) {
    if (name.startsWith(".")) continue;
    const stat = await statOrNull(path.join(attachmentsDir(), name));
    if (!stat?.isFile()) continue;
    const refs = [`attachments/${name}`, `attachments/${encodeURIComponent(name)}`, `attachments/${encodeURI(name)}`];
    const usedBy = notes.filter((n) => refs.some((r) => n.content.includes(r))).map((n) => n.title);
    items.push({ name, size: stat.size, mtime: stat.mtimeMs, usedBy });
  }
  return items.sort((a, b) => b.mtime - a.mtime);
}

export async function deleteAttachment(rawName: string): Promise<void> {
  const { file } = await statAttachment(rawName);
  await fs.unlink(file);
}

// Export

/** Every note (in its folders) and every attachment, as `[path in the zip, bytes]`. */
export async function exportFiles(): Promise<[string, Uint8Array][]> {
  const files: [string, Uint8Array][] = [];
  for (const { title } of await listNotes()) {
    const data = await fs.readFile(notePath(title)).catch(() => null);
    if (data) files.push([`${title}${EXT}`, data]);
  }
  for (const name of await fs.readdir(attachmentsDir())) {
    if (name.startsWith(".")) continue;
    const file = path.join(attachmentsDir(), name);
    if ((await statOrNull(file))?.isFile()) files.push([`attachments/${name}`, await fs.readFile(file)]);
  }
  return files;
}
