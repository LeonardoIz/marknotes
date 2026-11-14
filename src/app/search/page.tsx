import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { NoteRow } from "@/components/NoteRow";
import { Page } from "@/components/Page";
import { SearchBox } from "@/components/SearchBox";
import { Indicator } from "@/components/ui";
import { SaveView } from "@/components/SaveView";
import { RefreshWhile } from "@/components/RefreshWhile";
import { listViews } from "@/lib/db";
import { findNotes } from "@/lib/find";
import type { SortKey } from "@/lib/search";
import { semanticStatus } from "@/lib/semantic";

export const metadata: Metadata = { title: "Search" };

const SORTS: { key: SortKey; label: string }[] = [
  { key: "score", label: "Relevance" },
  { key: "title", label: "Title" },
  { key: "modified", label: "Modified" },
];

async function Results({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const all = !q.trim() || q.trim() === "*";
  // Views saved with the old "meaning" tab open as plain relevance: meaning is always part of it now.
  const sort = SORTS.find((s) => s.key === params.sort)?.key ?? "score";
  const { hits, meaning } = await findNotes(q, sort);
  const href = (key: SortKey) => `/search?q=${encodeURIComponent(q)}&sort=${key}`;

  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="kicker">{all ? "Library" : "Search"}</span>
        <h1 className="font-serif text-[38px] leading-none tracking-[-0.015em] wrap-break-word">
          {all ? "All notes" : <>“{q}”</>}
        </h1>
      </div>
      <div className="mt-8">
        <SearchBox key={q} initial={all ? "" : q} live={false} />
      </div>
      <div className="mt-8 flex items-center justify-between border-b pb-2.5">
        <span className="flex items-center gap-3">
          <span className="kicker">
            {hits.length} {hits.length === 1 ? "note" : "notes"}
          </span>
          {!all && <SaveView query={q.trim()} sort={sort} existing={listViews().find((v) => v.query === q.trim() && v.sort === sort)} />}
        </span>
        <nav aria-label="Sort by" className="relative flex rounded-lg border p-0.5 text-[12px]">
          <Indicator />
          {SORTS.map((s) => (
            <Link
              key={s.key}
              href={href(s.key)}
              scroll={false}
              aria-current={s.key === sort ? "page" : undefined}
              className={`relative rounded-sm px-2.5 py-0.5 transition-colors ${s.key === sort ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {s.label}
            </Link>
          ))}
        </nav>
      </div>
      {meaning === "preparing" && <Preparing />}
      {hits.length === 0 ? (
        <p className="mt-14 text-center font-serif text-lg text-muted-foreground italic">Nothing matches.</p>
      ) : (
        <ul className="animate-in duration-300 fade-in">
          {hits.map((hit) => (
            <NoteRow
              key={hit.title}
              title={hit.title}
              mtime={hit.mtime}
              below={
                <>
                  {hit.tags.length > 0 && (
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-brand">{hit.tags.slice(0, 6).map((t) => `#${t}`).join("  ")}</span>
                  )}
                  {hit.snippet && (
                    <span
                      className="mt-1 line-clamp-2 block text-[13px] leading-relaxed text-muted-foreground [&_mark]:bg-brand/15 [&_mark]:text-foreground"
                      dangerouslySetInnerHTML={{ __html: hit.snippet }}
                    />
                  )}
                </>
              }
            >
              <span className="[&_mark]:bg-brand/15 [&_mark]:text-inherit" dangerouslySetInnerHTML={{ __html: hit.titleHtml }} />
            </NoteRow>
          ))}
        </ul>
      )}
    </>
  );
}

/** Meaning joins the results once the model is ready (the first time it downloads and reads every note); until then, a quiet line and a check every few seconds. */
function Preparing() {
  const status = semanticStatus();
  if (status.state === "error") return null;
  return (
    <p role="status" className="flex items-center gap-2.5 border-b border-rule py-2.5 text-[12.5px] text-muted-foreground">
      <span aria-hidden className="size-[6px] shrink-0 animate-pulse bg-brand" />
      {status.state === "indexing"
        ? `Also finding notes by meaning soon: reading them, ${status.done} of ${status.total}.`
        : "Also finding notes by meaning soon: getting the model ready (the first time downloads about 120 MB)."}
      <RefreshWhile everyMs={2500} />
    </p>
  );
}

export default function SearchPage(props: PageProps<"/search">) {
  return (
    <Page className="mx-auto w-full max-w-[760px]">
      <Suspense>
        <Results {...props} />
      </Suspense>
    </Page>
  );
}
