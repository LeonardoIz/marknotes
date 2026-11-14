"use client";

import { FileIcon, Trash2 } from "lucide-react";
import Link from "next/link";
import { noteHref } from "@/lib/parse";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatBytes, formatDate } from "@/lib/format";
import type { AttachmentInfo } from "@/lib/notes";
import { Button, Indicator, toast, useConfirm } from "./ui";

const IMAGE = /\.(png|jpe?g|gif|webp|avif)$/i;
const url = (name: string) => `/attachments/${encodeURIComponent(name)}`;

export function AttachmentList({ items }: { items: AttachmentInfo[] }) {
  const router = useRouter();
  const [dialog, confirm] = useConfirm();
  const [filter, setFilter] = useState<"all" | "unused">("all");
  const [busy, setBusy] = useState(false);
  const unused = items.filter((a) => a.usedBy.length === 0);
  const shown = filter === "all" ? items : unused;
  const total = items.reduce((sum, a) => sum + a.size, 0);

  const deleteMany = async (names: string[]) => {
    setBusy(true);
    const results = await Promise.all(
      names.map((n) => fetch(`/api/attachments/${encodeURIComponent(n)}`, { method: "DELETE" }).then((r) => r.ok).catch(() => false)),
    );
    setBusy(false);
    const failed = results.filter((ok) => !ok).length;
    if (failed) toast(`${failed} could not be deleted.`, "error");
    else toast(names.length === 1 ? "Attachment deleted" : `${names.length} attachments deleted`);
    router.refresh();
  };

  const remove = async (a: AttachmentInfo) => {
    const ok = await confirm({
      title: "Delete attachment?",
      message: a.usedBy.length ? (
        <>
          <b className="font-medium text-foreground">{a.name}</b> is used by {a.usedBy.map((t) => `“${t}”`).join(", ")}. Those notes will show a broken link.
        </>
      ) : (
        <>
          <b className="font-medium text-foreground">{a.name}</b> is not used by any note. It will be erased.
        </>
      ),
      confirm: "Delete",
      danger: true,
    });
    if (ok) deleteMany([a.name]);
  };

  const removeUnused = async () => {
    const ok = await confirm({
      title: "Delete unused attachments?",
      message: `${unused.length} ${unused.length === 1 ? "file" : "files"} (${formatBytes(unused.reduce((s, a) => s + a.size, 0))}) that no note references will be erased.`,
      confirm: "Delete unused",
      danger: true,
    });
    if (ok) deleteMany(unused.map((a) => a.name));
  };

  return (
    <div className="animate-in duration-300 fade-in">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2.5">
        <span className="kicker flex gap-4">
          <span>
            {items.length} {items.length === 1 ? "file" : "files"}
          </span>
          <span>{formatBytes(total)}</span>
        </span>
        <span className="flex items-center gap-2">
          <span role="radiogroup" aria-label="Show" className="relative inline-flex rounded-lg border p-0.5 text-[12px]">
            <Indicator />
            {(["all", "unused"] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={filter === f}
                onClick={() => setFilter(f)}
                className={`relative rounded-sm px-2.5 py-0.5 transition-colors ${filter === f ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {f === "all" ? "All" : `Unused (${unused.length})`}
              </button>
            ))}
          </span>
          {unused.length > 0 && (
            <Button variant="destructive" size="sm" onClick={removeUnused} disabled={busy}>
              Delete unused
            </Button>
          )}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="mt-12 text-center font-serif text-lg text-muted-foreground italic">
          {filter === "all" ? "No attachments yet. Paste or drop files in the editor." : "Every attachment is in use."}
        </p>
      ) : (
        <ul>
          {shown.map((a) => (
            <li key={a.name} className="flex items-center gap-4 border-b border-rule py-3">
              <a href={url(a.name)} target="_blank" rel="noreferrer" aria-label={`Open ${a.name}`} className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border bg-card">
                {IMAGE.test(a.name) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a private, authenticated file; next/image would proxy it
                  <img src={url(a.name)} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <FileIcon aria-hidden className="size-4 text-faint" strokeWidth={1.5} />
                )}
              </a>
              <span className="min-w-0 grow">
                <span className="block truncate text-[14px]">{a.name}</span>
                <span className="flex gap-3 font-mono text-[11px] text-faint" suppressHydrationWarning>
                  <span>{formatBytes(a.size)}</span>
                  <span>{formatDate(a.mtime)}</span>
                </span>
                <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
                  {a.usedBy.length === 0 ? (
                    <span className="text-warn">Not used by any note</span>
                  ) : (
                    <>
                      In{" "}
                      {a.usedBy.map((t, i) => (
                        <span key={t}>
                          {i > 0 && ", "}
                          <Link href={noteHref(t)} className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-brand">
                            {t}
                          </Link>
                        </span>
                      ))}
                    </>
                  )}
                </span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => remove(a)} disabled={busy} aria-label={`Delete ${a.name}`}>
                <Trash2 aria-hidden strokeWidth={1.75} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
