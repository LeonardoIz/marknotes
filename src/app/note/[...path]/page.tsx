import type { Metadata } from "next";
import { Suspense } from "react";
import { NoteScreen } from "@/components/NoteScreen";
import { NoteRow } from "@/components/NoteRow";
import { buttonClass } from "@/lib/button";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Page } from "@/components/Page";
import { renderMarkdown } from "@/lib/markdown";
import { getSettings, isPinned } from "@/lib/db";
import { getNote, listFolders, NoteError, validateTitle } from "@/lib/notes";
import { noteName } from "@/lib/parse";
import { backlinks, resolver } from "@/lib/search";

type Props = PageProps<"/note/[...path]">;

// Page params arrive still URL-encoded (route handler params do not); bad escapes fall back to the raw value.
const decode = (raw: string) => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const titleOf = async ({ params }: Props) => (await params).path.map(decode).join("/");

export async function generateMetadata(props: Props): Promise<Metadata> {
  return { title: noteName(await titleOf(props)) };
}

async function Note(props: Props) {
  const title = await titleOf(props);
  const note = await getNote(title).catch((error) => {
    if (error instanceof NoteError && (error.status === 404 || error.status === 400)) return null;
    throw error;
  });
  // A [[link]] to a note that doesn't exist yet lands here: offer to write it.
  if (!note) return <MissingNote title={title} linkedFrom={await backlinks(title)} />;
  const [rendered, links, folders] = await Promise.all([
    resolver().then((resolve) => renderMarkdown(note.content, resolve, note.title)),
    backlinks(note.title),
    listFolders(),
  ]);
  return (
    <NoteScreen
      key={note.title}
      note={note}
      html={rendered.html}
      headings={rendered.headings}
      readingMinutes={rendered.readingMinutes}
      backlinks={links}
      startInEditor={(await props.searchParams).edit === "1"}
      folders={folders}
      pinned={isPinned(note.title)}
      prefs={getSettings()}
    />
  );
}

export default function NotePage(props: Props) {
  return (
    <Page className="flex flex-1 flex-col">
      <Suspense fallback={<NoteSkeleton />}>
        <Note {...props} />
      </Suspense>
    </Page>
  );
}

function NoteSkeleton() {
  return (
    <div aria-busy className="mx-auto w-full max-w-[760px] animate-pulse">
      <div className="flex flex-col gap-3 border-b pb-6">
        <div className="h-3 w-40 bg-secondary" />
        <div className="h-9 w-2/3 bg-secondary" />
      </div>
      <div className="mt-8 flex flex-col gap-3">
        {[92, 100, 84, 96, 60].map((w) => (
          <div key={w} className="h-3.5 bg-secondary" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

function MissingNote({ title, linkedFrom }: { title: string; linkedFrom: string[] }) {
  let creatable = true;
  try {
    validateTitle(title);
  } catch {
    creatable = false;
  }
  return (
    <div className="mx-auto w-full max-w-[760px] animate-in duration-300 fade-in">
      <div className="flex flex-col gap-2.5 border-b pb-6">
        <span className="kicker">Not written yet</span>
        <h1 className="font-serif text-[38px] leading-[1.1] tracking-[-0.015em] wrap-break-word text-muted-foreground italic">{noteName(title)}</h1>
      </div>
      <p className="mt-8 font-serif text-lg text-muted-foreground italic">
        {creatable ? "There is no note with this title yet." : "This can't be a note's title: it has characters a file name can't hold."}
      </p>
      {creatable && (
        <Link href={`/new?title=${encodeURIComponent(title)}`} className={`${buttonClass()} mt-6`}>
          <Plus aria-hidden strokeWidth={1.75} />
          Create “{noteName(title)}”
        </Link>
      )}
      {linkedFrom.length > 0 && (
        <section className="mt-16">
          <h2 className="kicker border-b pb-2.5">Linked from</h2>
          <ul>
            {linkedFrom.map((t) => (
              <NoteRow key={t} title={t} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
