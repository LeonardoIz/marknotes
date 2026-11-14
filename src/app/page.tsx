import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Logo } from "@/components/Logo";
import { NoteRow } from "@/components/NoteRow";
import { Page } from "@/components/Page";
import { SearchBox } from "@/components/SearchBox";
import { ViewList } from "@/components/ViewList";
import { getSettings, listPins, listViews } from "@/lib/db";
import { search } from "@/lib/search";

async function Sections() {
  await connection();
  const settings = getSettings();
  const all = await search("", "modified");
  const byTitle = new Map(all.map((n) => [n.title, n]));
  const pinned = settings.homeShowPinned ? listPins().flatMap((t) => byTitle.get(t) ?? []) : [];
  const views = settings.homeShowViews ? listViews() : [];
  const recent = all.filter((n) => !pinned.includes(n)).slice(0, settings.homeRecentCount);

  if (!all.length) {
    return (
      <p className="mt-12 text-center font-serif text-lg text-muted-foreground italic">
        Nothing here yet.{" "}
        <Link href="/new" className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-brand">
          Write the first note
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="mt-14 flex animate-in flex-col gap-12 duration-300 fade-in">
      {pinned.length > 0 && (
        <section>
          <h2 className="kicker border-b pb-2.5">Pinned</h2>
          <ul>
            {pinned.map((n) => (
              <NoteRow key={n.title} title={n.title} mtime={n.mtime} />
            ))}
          </ul>
        </section>
      )}
      {views.length > 0 && (
        <section>
          <h2 className="kicker border-b pb-2.5">Views</h2>
          <ViewList views={views} />
        </section>
      )}
      {recent.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between border-b pb-2.5">
            <h2 className="kicker">Recently modified</h2>
            {all.length > recent.length + pinned.length && (
              <Link href="/notes" className="font-mono text-[11px] text-faint transition-colors hover:text-foreground">
                All notes →
              </Link>
            )}
          </div>
          <ul>
            {recent.map((n) => (
              <NoteRow key={n.title} title={n.title} mtime={n.mtime} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <Page className="mx-auto w-full max-w-[640px] pt-[10vh]">
      <div className="flex flex-col items-center">
        <Logo size="lg" />
        <p className="mt-3 font-serif text-muted-foreground italic">Plain files, written in Markdown.</p>
      </div>
      <div className="mt-10">
        <SearchBox large />
      </div>
      <Suspense>
        <Sections />
      </Suspense>
    </Page>
  );
}
