import { Folder, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FolderActions } from "@/components/FolderActions";
import { NoteRow } from "@/components/NoteRow";
import { Page } from "@/components/Page";
import { buttonClass } from "@/lib/button";
import { listFolders, listNotes } from "@/lib/notes";
import { folderHref, noteName, parentFolder } from "@/lib/parse";

type Props = PageProps<"/notes/[[...path]]">;

const decode = (raw: string) => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};
const folderOf = async ({ params }: Props) => ((await params).path ?? []).map(decode).join("/");
const byName = (a: string, b: string) => noteName(a).localeCompare(noteName(b), undefined, { sensitivity: "base", numeric: true });

export async function generateMetadata(props: Props): Promise<Metadata> {
  const folder = await folderOf(props);
  return { title: folder ? noteName(folder) : "All notes" };
}

async function Listing(props: Props) {
  const folder = await folderOf(props);
  const [notes, folders] = await Promise.all([listNotes(), listFolders()]);
  if (folder && !folders.includes(folder)) notFound();

  const inside = (path: string) => !folder || path.startsWith(`${folder}/`);
  const subfolders = folders.filter((f) => inside(f) && parentFolder(f) === folder).sort(byName);
  const here = notes.filter((n) => parentFolder(n.title) === folder).sort((a, b) => byName(a.title, b.title));
  const count = (f: string) => notes.filter((n) => n.title.startsWith(`${f}/`)).length;
  const crumbs = folder ? folder.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/")) : [];

  return (
    <>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b pb-6">
        <div className="flex min-w-0 grow basis-72 flex-col gap-2.5">
          <nav aria-label="Folders" className="kicker flex min-w-0 flex-wrap items-center gap-x-1.5">
            {folder ? (
              <Link href="/notes" className="transition-colors hover:text-foreground">
                All notes
              </Link>
            ) : (
              <span>{notes.length === 1 ? "1 note" : `${notes.length} notes`}</span>
            )}
            {crumbs.slice(0, -1).map((c) => (
              <span key={c} className="contents">
                <span aria-hidden>/</span>
                <Link href={folderHref(c)} className="transition-colors hover:text-foreground">
                  {noteName(c)}
                </Link>
              </span>
            ))}
          </nav>
          <h1 className="font-serif text-[38px] leading-[1.1] tracking-[-0.015em] wrap-break-word">{folder ? noteName(folder) : "All notes"}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <FolderActions folder={folder} empty={!here.length && !subfolders.length} />
          <Link href={folder ? `/new?folder=${encodeURIComponent(folder)}` : "/new"} className={buttonClass("outline")}>
            <Plus aria-hidden strokeWidth={1.75} />
            New note
          </Link>
        </div>
      </div>

      {subfolders.length === 0 && here.length === 0 ? (
        <p className="mt-14 text-center font-serif text-lg text-muted-foreground italic">{folder ? "This folder is empty." : "No notes yet."}</p>
      ) : (
        <ul className="animate-in duration-300 fade-in">
          {subfolders.map((f) => (
            <li key={f} className="border-b border-rule">
              <Link
                href={folderHref(f)}
                className="group -mx-2 flex items-center gap-3 rounded-sm px-2 py-3 text-[15px] transition-colors hover:bg-secondary/50 hover:text-brand"
              >
                <Folder aria-hidden className="size-4 shrink-0 text-faint transition-colors group-hover:text-brand" strokeWidth={1.75} />
                <span className="min-w-0 grow truncate">{noteName(f)}</span>
                <span className="shrink-0 font-mono text-[11px] text-faint">{count(f) === 1 ? "1 note" : `${count(f)} notes`}</span>
              </Link>
            </li>
          ))}
          {here.map((n) => (
            <NoteRow key={n.title} title={n.title} mtime={n.mtime} showFolder={false} />
          ))}
        </ul>
      )}
    </>
  );
}

export default function NotesPage(props: Props) {
  return (
    <Page className="mx-auto w-full max-w-[760px]">
      <Suspense>
        <Listing {...props} />
      </Suspense>
    </Page>
  );
}
