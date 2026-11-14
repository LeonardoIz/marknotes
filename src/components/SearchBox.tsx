"use client";

import { ArrowRight, FileText, Hash, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { noteHref, parentFolder } from "@/lib/parse";

type Hit = { title: string; titleHtml: string; mtime: number; snippet: string | null; tags: string[] };
type Option = { kind: "note"; hit: Hit } | { kind: "tag"; tag: string };

let tagsCache: Promise<string[]> | null = null;
const loadTags = (): Promise<string[]> =>
  (tagsCache ??= fetch("/api/tags")
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])
    .finally(() => setTimeout(() => (tagsCache = null), 30_000)));

/**
 * Search input with live results. Typing `#` suggests tags. Enter opens the highlighted
 * note, or the full results page when nothing is highlighted.
 */
export function SearchBox({
  initial = "",
  autoFocus,
  onDone,
  live = true,
  large,
}: {
  initial?: string;
  autoFocus?: boolean;
  onDone?: () => void;
  live?: boolean;
  large?: boolean;
}) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState(initial);
  const [options, setOptions] = useState<Option[]>([]);
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const tagToken = /(?:^|\s)#([^\s#]*)$/.exec(query)?.[1];

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      let next: Option[] = [];
      if (tagToken !== undefined) {
        const tags = await loadTags();
        next = tags
          .filter((t) => t.startsWith(tagToken.toLowerCase()))
          .slice(0, 8)
          .map((tag) => ({ kind: "tag", tag }));
      } else if (live && query.trim()) {
        const res = await fetch(`/api/search?limit=8&q=${encodeURIComponent(query)}`);
        if (res.ok) next = ((await res.json()) as Hit[]).map((hit) => ({ kind: "note", hit }));
      }
      if (!cancelled) {
        setOptions(next);
        setActive(tagToken !== undefined && next.length ? 0 : -1);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, tagToken, live]);

  const choose = (option: Option | undefined) => {
    if (option?.kind === "tag") {
      setQuery(query.replace(/#[^\s#]*$/, `#${option.tag} `));
      inputRef.current?.focus();
      return;
    }
    if (option?.kind === "note") router.push(noteHref(option.hit.title));
    else if (query.trim()) router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    else return;
    onDone?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!options.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      // Cycles through -1 (nothing highlighted) .. options.length - 1.
      setActive((a) => ((a + step + 1 + options.length + 1) % (options.length + 1)) - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(e.shiftKey ? undefined : options[active]);
    } else if (e.key === "Tab" && tagToken !== undefined && options[0]) {
      e.preventDefault();
      choose(options[Math.max(active, 0)]);
    }
  };

  const modal = !!onDone;
  const showList = (focused || modal) && options.length > 0;

  return (
    <div className="relative w-full">
      <div
        className={
          modal
            ? "flex items-center gap-3 border-b px-4"
            : `flex items-center gap-3 rounded-lg border bg-field px-3.5 transition-colors hover:border-ring/60 focus-within:border-ring ${large ? "h-12 text-[15px]" : "h-10"}`
        }
      >
        <Search className="size-4 shrink-0 text-faint" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search notes, #tags…"
          aria-label="Search notes"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          className={`w-full bg-transparent outline-none placeholder:text-faint ${modal ? "h-12 text-[15px]" : ""}`}
        />
        {modal && <kbd className="font-mono text-[11px] text-faint">esc</kbd>}
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className={`${modal ? "" : "absolute z-30 mt-1.5 animate-in rounded-lg border bg-popover shadow-lg duration-150 fade-in slide-in-from-top-1"} flex max-h-[50vh] w-full flex-col overflow-y-auto p-1.5`}
        >
          {options.map((option, i) => (
            <li
              key={option.kind === "tag" ? `#${option.tag}` : option.hit.title}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(option)}
              onPointerMove={() => setActive(i)}
              className={`flex cursor-pointer items-start gap-3 rounded-md px-3 py-2 transition-colors ${i === active ? "bg-secondary" : ""}`}
            >
              {option.kind === "tag" ? (
                <>
                  <Hash className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
                  <span className="font-mono text-[13px]">{option.tag}</span>
                </>
              ) : (
                <>
                  <FileText className="mt-[3px] size-3.5 shrink-0 text-faint" aria-hidden />
                  <span className="min-w-0 grow">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span
                        className="truncate text-sm [&_mark]:bg-brand/15 [&_mark]:text-inherit"
                        dangerouslySetInnerHTML={{ __html: option.hit.titleHtml }}
                      />
                      {parentFolder(option.hit.title) && (
                        <span className="shrink-[2] truncate font-mono text-[11px] text-faint">{parentFolder(option.hit.title)}</span>
                      )}
                    </span>
                    {option.hit.snippet && (
                      <span
                        className="line-clamp-1 text-[12.5px] text-muted-foreground [&_mark]:bg-brand/15 [&_mark]:text-foreground"
                        dangerouslySetInnerHTML={{ __html: option.hit.snippet }}
                      />
                    )}
                  </span>
                  {i === active && <ArrowRight aria-hidden className="mt-[3px] size-3.5 shrink-0 text-faint" />}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {modal && query.trim() && !options.length && tagToken === undefined && (
        <p className="px-3 py-6 text-center font-serif text-muted-foreground italic">
          Press Enter to search everything for “{query.trim()}”.
        </p>
      )}
    </div>
  );
}
