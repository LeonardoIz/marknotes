/**
 * Template variables, shared by the browser (new note from a template) and the server (daily note).
 * Times are the writer's local wall-clock time, passed as plain parts so the server's timezone never leaks in.
 */
export type LocalTime = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export const localTime = (d = new Date()): LocalTime => ({
  year: d.getFullYear(),
  month: d.getMonth() + 1,
  day: d.getDate(),
  hour: d.getHours(),
  minute: d.getMinutes(),
  second: d.getSeconds(),
});

/** `2026-11-13T21:05:09` (no zone) → its parts; null if it isn't one. */
export function parseLocalTime(value: unknown): LocalTime | null {
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value) : null;
  if (!m) return null;
  const [year, month, day, hour, minute, second = 0] = m.slice(1).map(Number);
  const check = new Date(year, month - 1, day, hour, minute, second);
  if (check.getMonth() !== month - 1 || check.getDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  return { year, month, day, hour, minute, second };
}

export const toLocalString = (t: LocalTime) => formatTime("YYYY-MM-DDTHH:mm:ss", t);

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** YYYY YY MM M DD D HH H mm ss, and [literal text] in brackets. Anything else is kept as written. */
export function formatTime(format: string, t: LocalTime): string {
  const tokens: Record<string, string> = {
    YYYY: String(t.year),
    YY: pad(t.year % 100),
    MM: pad(t.month),
    M: String(t.month),
    DD: pad(t.day),
    D: String(t.day),
    HH: pad(t.hour),
    H: String(t.hour),
    mm: pad(t.minute),
    ss: pad(t.second),
  };
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MM|M|DD|D|HH|H|mm|ss/g, (token, literal?: string) => literal ?? tokens[token]);
}

/**
 * Fills `{{title}}`, `{{date}}` (YYYY-MM-DD), `{{time}}` (HH:mm), `{{datetime}}` and `{{date:FORMAT}}`.
 * Unknown `{{…}}` stay as they are, so a template can still show braces.
 */
export function applyTemplate(content: string, { title, now }: { title: string; now: LocalTime }): string {
  return content.replace(/\{\{\s*(title|date|time|datetime)(?::([^}]*))?\s*\}\}/g, (_, name: string, format?: string) => {
    if (name === "title") return title;
    if (format?.trim()) return formatTime(format.trim(), now);
    return formatTime(name === "date" ? "YYYY-MM-DD" : name === "time" ? "HH:mm" : "YYYY-MM-DD HH:mm", now);
  });
}
