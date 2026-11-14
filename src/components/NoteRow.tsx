import Link from "next/link";
import { formatDate } from "@/lib/format";
import { noteHref, noteName, parentFolder } from "@/lib/parse";
import { NoteName } from "./Page";

/**
 * One ruled row of a note list: the note's name (its folder beside it, quieter) on the left,
 * its date in mono on the right. `children` replaces the name, e.g. with search highlights.
 */
export function NoteRow({
  title,
  mtime,
  children,
  below,
  showFolder = true,
}: {
  title: string;
  /** Left out when unknown. */
  mtime?: number;
  children?: React.ReactNode;
  below?: React.ReactNode;
  /** Off where the list is already one folder's content. */
  showFolder?: boolean;
}) {
  const folder = showFolder ? parentFolder(title) : "";
  return (
    <li className="border-b border-rule">
      <Link
        href={noteHref(title)}
        title={title}
        className="group -mx-2 flex items-baseline gap-4 rounded-sm px-2 py-3 transition-colors hover:bg-secondary/50"
      >
        <span className="min-w-0 grow">
          <span className="flex min-w-0 items-baseline gap-2 text-[15px] transition-colors group-hover:text-brand">
            <NoteName title={title}>{children ?? noteName(title)}</NoteName>
            {folder && <span className="min-w-0 shrink-[2] truncate font-mono text-[11px] text-faint">{folder}</span>}
          </span>
          {below}
        </span>
        {mtime !== undefined && <span className="shrink-0 font-mono text-[11px] text-faint">{formatDate(mtime)}</span>}
      </Link>
    </li>
  );
}
