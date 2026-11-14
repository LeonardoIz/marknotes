import { getSettings } from "./db";
import { createNote, getNote, listNotes, NoteError, validateFolder, validateTitle, type Note } from "./notes";
import { noteName } from "./parse";
import { applyTemplate, formatTime, type LocalTime } from "./templates";

export type Template = { title: string; name: string; content: string };

/** The notes in the templates folder (and its subfolders), by name. */
export async function listTemplates(): Promise<Template[]> {
  const folder = getSettings().templatesFolder;
  if (!folder) return [];
  const inside = (await listNotes()).filter((n) => n.title.startsWith(`${folder}/`));
  const templates = await Promise.all(
    inside.map(async (n) => ({ title: n.title, name: n.title.slice(folder.length + 1), content: (await getNote(n.title)).content })),
  );
  return templates.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Today's daily note title for the writer's local time, per the settings: `Daily/2026-11-13`. */
export function dailyTitle(now: LocalTime): string {
  const { dailyFolder, dailyFormat } = getSettings();
  const name = formatTime(dailyFormat, now);
  const title = dailyFolder ? `${validateFolder(dailyFolder)}/${name}` : name;
  try {
    return validateTitle(title);
  } catch (error) {
    throw new NoteError(`The daily note format makes an invalid title (“${title}”): ${(error as Error).message}`, 400);
  }
}

/** Opens today's note, creating it (from the daily template, if one is set) the first time. */
export async function openDaily(now: LocalTime): Promise<{ note: Note; created: boolean }> {
  const title = dailyTitle(now);
  try {
    return { note: await getNote(title), created: false };
  } catch (error) {
    if (!(error instanceof NoteError && error.status === 404)) throw error;
  }
  const { dailyTemplate, templatesFolder } = getSettings();
  let content = "";
  if (dailyTemplate) {
    const template = await getNote(templatesFolder ? `${templatesFolder}/${dailyTemplate}` : dailyTemplate).catch(() => null);
    if (template) content = applyTemplate(template.content, { title: noteName(title), now });
  }
  try {
    return { note: await createNote(title, content), created: true };
  } catch (error) {
    // Two tabs opening today at once: the other one won.
    if (error instanceof NoteError && error.status === 409) return { note: await getNote(title), created: false };
    throw error;
  }
}
