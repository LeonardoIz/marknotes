const time = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayMonth = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });
const full = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Short and telling: "14:05" today, "Yesterday", "Nov 12" this year, "Nov 12, 2025" before. */
export function formatDate(ms: number, now = Date.now()): string {
  const date = new Date(ms);
  const today = startOfDay(new Date(now));
  if (ms >= today) return time.format(date);
  if (ms >= today - 86_400_000) return "Yesterday";
  if (date.getFullYear() === new Date(now).getFullYear()) return dayMonth.format(date);
  return full.format(date);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}
