"use client";

import { ArrowRight, Check, Ellipsis, Eye, FileDown, Folder, LayoutTemplate, Pencil, PenLine, Pin, Printer, Save, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Heading } from "@/lib/markdown";
import { folderHref, noteApi, noteHref, noteName, parentFolder } from "@/lib/parse";
import { applyTemplate, localTime } from "@/lib/templates";
import type { EditorHandle } from "./Editor";
import { holdRefreshes, onNoteChange } from "./LiveUpdates";
import { Menu, menuItem } from "./Menu";
import { NoteName } from "./Page";
import { Rendered } from "./Rendered";
import { Button, toast, useConfirm } from "./ui";

const Editor = dynamic(() => import("./Editor"), {
  ssr: false,
  loading: () => <p className="font-serif text-muted-foreground italic">Opening the editor…</p>,
});

type Note = { title: string; content: string; mtime: number };

/** The settings this screen follows (a subset of the app's settings). */
export type NotePrefs = {
  editorFont: "sans" | "mono";
  editorSpellcheck: boolean;
  readingShowToc: boolean;
  readingShowBacklinks: boolean;
  readingInteractiveTasks: boolean;
};
const DEFAULT_PREFS: NotePrefs = {
  editorFont: "sans",
  editorSpellcheck: true,
  readingShowToc: true,
  readingShowBacklinks: true,
  readingInteractiveTasks: true,
};
type Draft = { title: string; content: string };
export type TemplateOption = { name: string; content: string };
const joinPath = (folder: string, name: string) => {
  const f = folder.trim().replace(/^\/+|\/+$/g, "");
  return f ? `${f}/${name.trim()}` : name.trim();
};

const draftKey = (title: string | undefined) => `notes:draft:${title ?? ""}`;
const readDraft = (title?: string): Draft | null => {
  try {
    return JSON.parse(localStorage.getItem(draftKey(title)) ?? "null");
  } catch {
    return null;
  }
};
const clearDraft = (title?: string) => {
  try {
    localStorage.removeItem(draftKey(title));
  } catch {}
};

export function NoteScreen({
  note,
  html = "",
  headings = [],
  readingMinutes = 0,
  backlinks = [],
  startInEditor = false,
  pinned = false,
  prefs = DEFAULT_PREFS,
  initialTitle,
  initialFolder = "",
  folders = [],
  templates = [],
}: {
  note: Note | null;
  html?: string;
  headings?: Heading[];
  readingMinutes?: number;
  backlinks?: string[];
  startInEditor?: boolean;
  pinned?: boolean;
  prefs?: NotePrefs;
  /** A new note's title (a path, maybe), prefilled from a [[link]] to it. */
  initialTitle?: string;
  /** A new note's folder, when made from a folder's page. */
  initialFolder?: string;
  /** Every folder, offered when choosing where the note goes. */
  folders?: string[];
  /** A new note can start from one of these. */
  templates?: TemplateOption[];
}) {
  const router = useRouter();
  const [dialog, confirm] = useConfirm();
  const isNew = note === null;
  const [editing, setEditing] = useState(isNew || startInEditor);
  const start = note?.title ?? initialTitle ?? "";
  // The title input holds the name; the folder is chosen beside it. Typing a / in the name still works.
  const [title, setTitle] = useState(noteName(start));
  const [folder, setFolder] = useState(start.includes("/") ? parentFolder(start) : initialFolder);
  const path = joinPath(folder, title);
  const listId = useId();
  const editor = useRef<EditorHandle | null>(null);
  const savingNow = useRef(false);
  const [elsewhere, setElsewhere] = useState<"changed" | "deleted" | null>(null);
  const [initial, setInitial] = useState(note?.content ?? "");
  const content = useRef(note?.content ?? "");
  const base = useRef(note?.mtime);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0); // bump to remount the editor with new `initial`
  const [isPinned, setIsPinned] = useState(pinned);
  const [preview, setPreview] = useState<{ html: string } | null>(null);

  const offerDraft = useCallback(async () => {
    const draft = readDraft(note?.title);
    if (!draft || (draft.content === (note?.content ?? "") && draft.title === (note?.title ?? ""))) return;
    const resume = await confirm({
      title: "Unsaved draft",
      message: "This browser has unsaved changes for this note. Resume them or discard them?",
      confirm: "Resume draft",
      cancel: "Discard",
    });
    if (resume) {
      setTitle(noteName(draft.title));
      setFolder(parentFolder(draft.title));
      setInitial(draft.content);
      content.current = draft.content;
      setEditorVersion((v) => v + 1);
      setDirty(true);
    } else {
      clearDraft(note?.title);
    }
  }, [confirm, note]);

  const startEditing = useCallback(async () => {
    // Start from the latest server copy (it may have been refreshed since the last edit).
    setTitle(noteName(note?.title ?? ""));
    setFolder(parentFolder(note?.title ?? ""));
    setElsewhere(null);
    setInitial(note?.content ?? "");
    content.current = note?.content ?? "";
    // After a save, our mtime can be newer than props until router.refresh() lands.
    if (note && !(base.current && base.current > note.mtime)) base.current = note.mtime;
    setDirty(false);
    await offerDraft();
    setEditing(true);
  }, [note, offerDraft]);

  // A new note opens straight in the editor; offer its draft if one was left behind.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the draft lives in localStorage, only readable after mount
    if (isNew) void offerDraft();
  }, [isNew, offerDraft]);

  // Persist a draft while typing; warn before leaving with unsaved changes.
  useEffect(() => {
    if (!editing || !dirty) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(note?.title), JSON.stringify({ title: path, content: content.current }));
      } catch {}
    }, 500);
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeunload", warn);
    };
  });

  // `e` to edit while reading.
  useEffect(() => {
    if (editing) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      if (e.key === "e" && !e.ctrlKey && !e.metaKey && !e.altKey && !typing) {
        e.preventDefault();
        startEditing();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, startEditing]);

  // While writing, the page doesn't refresh under the editor; a change to this note on disk is shown instead.
  useEffect(() => {
    if (!editing) return;
    const release = holdRefreshes();
    const off = onNoteChange((change) => {
      if (!note || change.title !== note.title) return;
      // Our own save also lands here; by the time it settles, `base` holds its mtime.
      setTimeout(() => {
        if (savingNow.current || change.mtime === base.current) return;
        setElsewhere(change.mtime === null ? "deleted" : "changed");
      }, 700);
    });
    return () => {
      release();
      off();
    };
  }, [editing, note]);

  const loadTheirs = async () => {
    if (!note) return;
    const res = await fetch(noteApi(note.title)).catch(() => null);
    if (!res?.ok) return toast("Could not load the note.", "error");
    const theirs = await res.json();
    editor.current?.setText(theirs.content); // undoable, if you want yours back
    content.current = theirs.content;
    base.current = theirs.mtime;
    clearDraft(note.title);
    setDirty(false);
    setElsewhere(null);
    router.refresh();
  };

  const save = async (overwrite = false, stayInEditor = true): Promise<boolean> => {
    const newTitle = path;
    if (!title.trim()) {
      toast("Give the note a title first.", "error");
      return false;
    }
    setSaving(true);
    savingNow.current = true;
    try {
      const res = !note
        ? await fetch("/api/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: newTitle, content: content.current }),
          })
        : await fetch(noteApi(note.title), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: newTitle,
              content: content.current,
              baseMtime: overwrite ? undefined : base.current,
            }),
          });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && note && /changed somewhere else/.test(data.error)) {
        const ok = await confirm({
          title: "Changed elsewhere",
          message: "This note was modified outside this editor since you opened it. Overwrite those changes with yours?",
          confirm: "Overwrite",
          danger: true,
        });
        return ok ? save(true, stayInEditor) : false;
      }
      if (res.status === 401) {
        toast("Your session expired. Your draft is kept in this browser; log in again.", "error");
        return false;
      }
      if (!res.ok) {
        toast(data.error ?? "Could not save the note.", "error");
        return false;
      }
      clearDraft(note?.title);
      base.current = data.mtime;
      setDirty(false);
      setElsewhere(null);
      toast("Saved ✓");
      if (!note || data.title !== note.title) {
        router.replace(`${noteHref(data.title)}${stayInEditor ? "?edit=1" : ""}`);
      }
      else router.refresh();
      return true;
    } catch {
      toast("Network error, not saved. Your draft is kept in this browser.", "error");
      return false;
    } finally {
      setSaving(false);
      // A beat longer than the watcher's settle time, so our own write isn't reported as someone else's.
      setTimeout(() => (savingNow.current = false), 900);
    }
  };

  const exit = async () => {
    if (dirty) {
      const keep = await confirm({
        title: "Save changes?",
        message: "You have unsaved changes.",
        confirm: "Save",
        cancel: "Discard",
      });
      if (keep) {
        if (!(await save(false, false)) || !note) return; // a saved new note already navigated to its page
      } else {
        clearDraft(note?.title);
      }
    }
    if (!note) return router.push(folder.trim() ? folderHref(joinPath(folder, "")) : "/");
    setDirty(false);
    setPreview(null);
    setElsewhere(null);
    setEditing(false);
    router.refresh(); // catch up on anything that changed while writing
  };

  const remove = async () => {
    if (!note) return;
    const ok = await confirm({
      title: "Delete note?",
      message: (
        <>
          <b className="font-medium text-foreground">{noteName(note.title)}</b> will be moved to the trash. You can restore it from Settings.
        </>
      ),
      confirm: "Delete",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(noteApi(note.title), { method: "DELETE" });
    if (!res.ok) return toast("Could not delete the note.", "error");
    clearDraft(note.title);
    toast("Note deleted");
    router.push(parentFolder(note.title) ? folderHref(parentFolder(note.title)) : "/");
    router.refresh();
  };

  const togglePin = async () => {
    if (!note) return;
    const next = !isPinned;
    setIsPinned(next);
    const res = await fetch("/api/pins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: note.title, pinned: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setIsPinned(!next);
      return toast("Could not change the pin.", "error");
    }
    toast(next ? "Pinned to home" : "Unpinned");
  };

  // Rendered by the server's pipeline, so the preview matches the saved note exactly.
  const togglePreview = async () => {
    if (preview) return setPreview(null);
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.current, title: path }),
    }).catch(() => null);
    if (!res?.ok) return toast("Could not render the preview.", "error");
    setPreview({ html: (await res.json()).html });
  };

  const toggleTask = async (index: number, checked: boolean) => {
    if (!note) return false;
    // After our own save `base` can be ahead of the props; after a change on disk, the props are.
    const baseMtime = base.current && base.current > note.mtime ? base.current : note.mtime;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: note.title, index, checked, baseMtime }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (!res?.ok) {
      toast(data?.error ?? "Could not update the task.", "error");
      router.refresh();
      return false;
    }
    base.current = data.mtime;
    router.refresh();
    return true;
  };

  // In the preview, a ticked box edits the text being written (one undoable change), not the saved file.
  const togglePreviewTask = async (index: number, checked: boolean) => {
    const { toggleTask: flip } = await import("@/lib/tasks");
    try {
      editor.current?.setText(flip(content.current, index, checked));
      return true;
    } catch {
      return false;
    }
  };

  const applyChosenTemplate = async (name: string) => {
    const template = templates.find((t) => t.name === name);
    if (!template) return;
    if (content.current.trim()) {
      const ok = await confirm({
        title: "Replace the text?",
        message: <>The template “{name}” replaces what you have written so far. Undo (Ctrl+Z) brings it back.</>,
        confirm: "Use template",
      });
      if (!ok) return;
    }
    editor.current?.setText(applyTemplate(template.content, { title: title.trim() || "Untitled", now: localTime() }));
  };

  const download = () => {
    if (!note) return;
    const url = URL.createObjectURL(new Blob([note.content], { type: "text/markdown;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${noteName(note.title)}.md` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const togglePreviewRef = useRef(togglePreview);
  useEffect(() => {
    togglePreviewRef.current = togglePreview;
  });

  // Ctrl+Alt+P toggles the preview while writing (from the editor or from the preview itself).
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.code === "KeyP") {
        e.preventDefault();
        togglePreviewRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  const modified = note ? new Date(note.mtime).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) : "";
  const noteFolder = note ? parentFolder(note.title) : "";
  const toc = headings.filter((h) => h.depth <= 3);
  const titleClass = "font-serif text-[38px] leading-[1.1] tracking-[-0.015em] wrap-break-word";

  return (
    <div className="flex flex-1">
      {dialog}
      {/* The article keeps its place whether or not the outline is shown beside it. */}
      <article className="relative mx-auto flex w-full max-w-[760px] min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-start gap-x-4 gap-y-3 border-b pb-6">
          <div className="flex min-w-0 grow basis-80 flex-col gap-2.5">
            <span className="kicker">
              {editing ? (
                <span className="flex items-center gap-2">
                  {isNew ? "New note" : "Editing"}
                  <span
                    aria-live="polite"
                    className={`flex items-center gap-1.5 normal-case tracking-normal transition-opacity duration-300 ${dirty ? "opacity-100" : "opacity-0"}`}
                  >
                    <span aria-hidden className="size-[6px] animate-pulse bg-brand" />
                    {dirty ? "unsaved" : ""}
                  </span>
                </span>
              ) : (
                <span className="flex flex-wrap gap-x-4 gap-y-1">
                  {noteFolder && (
                    <Link href={folderHref(noteFolder)} className="transition-colors hover:text-foreground">
                      {noteFolder}
                    </Link>
                  )}
                  <span>{modified}</span>
                  {readingMinutes > 0 && <span>{readingMinutes} min read</span>}
                </span>
              )}
            </span>
            {editing ? (
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setDirty(true);
                }}
                placeholder="Untitled"
                aria-label="Title"
                autoFocus={isNew && !initialTitle}
                className={`${titleClass} w-full bg-transparent outline-none placeholder:text-faint placeholder:italic`}
              />
            ) : (
              note && (
                <h1 className={titleClass}>
                  <NoteName title={note.title} wrap>
                    {noteName(note.title)}
                  </NoteName>
                </h1>
              )
            )}
            {editing && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted-foreground">
                <label className="flex min-w-0 items-center gap-2" title="Folder (type a new one to create it)">
                  <Folder aria-hidden className="size-3.5 shrink-0 text-faint" strokeWidth={1.75} />
                  <span className="sr-only">Folder</span>
                  <input
                    list={listId}
                    value={folder}
                    onChange={(e) => {
                      setFolder(e.target.value);
                      setDirty(true);
                    }}
                    placeholder="No folder"
                    className="w-52 min-w-0 border-b border-transparent bg-transparent py-0.5 outline-none transition-colors placeholder:text-faint hover:border-border focus:border-brand/60"
                  />
                  <datalist id={listId}>
                    {folders.map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                </label>
                {isNew && templates.length > 0 && (
                  <label className="flex items-center gap-2">
                    <LayoutTemplate aria-hidden className="size-3.5 shrink-0 text-faint" strokeWidth={1.75} />
                    <span className="sr-only">Template</span>
                    <select
                      value=""
                      onChange={(e) => void applyChosenTemplate(e.target.value)}
                      className="cursor-pointer bg-transparent py-0.5 outline-none transition-colors hover:text-foreground"
                    >
                      <option value="">Start from a template…</option>
                      {templates.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
          </div>
          {/* Lined up with the title's first line, however many lines it wraps to. */}
          <div className="no-print flex shrink-0 items-center gap-2 sm:mt-[29px]">
            {!isNew && !editing && (
              <Button
                variant="ghost"
                size="icon"
                onClick={togglePin}
                aria-pressed={isPinned}
                title={isPinned ? "Unpin from home" : "Pin to home"}
                aria-label={isPinned ? "Unpin" : "Pin"}
                className={isPinned ? "text-brand hover:text-brand" : ""}
              >
                <Pin aria-hidden className="size-4 transition-[fill] duration-200" strokeWidth={1.75} fill={isPinned ? "currentColor" : "none"} />
              </Button>
            )}
            {!isNew && !editing && (
              <Menu label="More" icon={<Ellipsis aria-hidden className="size-4" strokeWidth={1.75} />}>
                <button role="menuitem" type="button" className={menuItem} onClick={download}>
                  <FileDown aria-hidden /> Download Markdown
                </button>
                <button role="menuitem" type="button" className={menuItem} onClick={() => window.print()}>
                  <Printer aria-hidden /> Print or save as PDF
                </button>
                <span className="my-1 h-px bg-border" />
                <button role="menuitem" type="button" className={`${menuItem} hover:text-destructive`} onClick={remove}>
                  <Trash2 aria-hidden /> Delete
                </button>
              </Menu>
            )}
            {editing ? (
              <>
                <Button variant="ghost" onClick={togglePreview} aria-pressed={!!preview} title="Preview (Ctrl+Alt+P)">
                  {preview ? <PenLine aria-hidden strokeWidth={1.75} /> : <Eye aria-hidden strokeWidth={1.75} />}
                  {preview ? "Write" : "Preview"}
                </Button>
                <Button variant="outline" onClick={() => save()} disabled={saving} title="Save (Ctrl+S)">
                  <Save aria-hidden strokeWidth={1.75} />
                  {saving ? "Saving" : "Save"}
                </Button>
                <Button onClick={exit} title="Done (Esc)">
                  <Check aria-hidden strokeWidth={1.75} />
                  Done
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={startEditing} title="Edit (E)">
                <Pencil aria-hidden strokeWidth={1.75} />
                Edit
              </Button>
            )}
          </div>
        </header>

        {elsewhere && (
          <div role="alert" className="no-print mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-brand/40 bg-brand/5 px-4 py-3 text-[13.5px]">
            <span className="grow">
              {elsewhere === "changed"
                ? "This note was changed somewhere else while you were writing."
                : "This note was deleted or moved somewhere else while you were writing. Saving puts it back."}
            </span>
            {elsewhere === "changed" && (
              <Button variant="outline" size="sm" onClick={loadTheirs}>
                Load that version
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setElsewhere(null)}>
              Keep mine
            </Button>
          </div>
        )}

        {/* Keyed by mode so switching between reading and writing fades the new one in. */}
        <div key={editing ? "edit" : "read"} className="mt-8 flex flex-1 animate-in flex-col duration-300 fade-in slide-in-from-bottom-1">
          {editing ? (
            <>
              {/* The editor stays mounted under the preview, so its undo history survives. */}
              <div className={preview ? "hidden" : "flex flex-1 flex-col"}>
                <Editor
                  key={editorVersion}
                  initial={initial}
                  font={prefs.editorFont}
                  spellcheck={prefs.editorSpellcheck}
                  onChange={(value) => {
                    content.current = value;
                    setDirty(true);
                  }}
                  onSave={() => save()}
                  onExit={exit}
                  autoFocus={!isNew || !!initialTitle}
                  onReady={(h) => (editor.current = h)}
                />
              </div>
              {preview && (
                <div className="animate-in duration-200 fade-in">
                  <Rendered html={preview.html} onToggleTask={togglePreviewTask} />
                </div>
              )}
            </>
          ) : (
            <>
              {note?.content.trim() ? (
                <Rendered html={html} onToggleTask={prefs.readingInteractiveTasks ? toggleTask : undefined} />
              ) : (
                <p className="font-serif text-lg text-muted-foreground italic">
                  This note is empty. Press{" "}
                  <kbd className="rounded-sm border border-b-2 px-1.5 py-px font-mono text-[12px] not-italic">E</kbd> to start writing.
                </p>
              )}
              {prefs.readingShowBacklinks && backlinks.length > 0 && (
                <section className="no-print mt-16">
                  <h2 className="kicker border-b pb-2.5">Linked from</h2>
                  <ul>
                    {backlinks.map((b) => (
                      <li key={b} className="border-b border-rule">
                        <Link
                          href={noteHref(b)}
                          className="group flex items-center justify-between gap-3 py-2.5 text-[14px] transition-colors hover:text-brand"
                        >
                          <span className="flex min-w-0 items-baseline gap-2">
                            <NoteName title={b}>{noteName(b)}</NoteName>
                            {parentFolder(b) && <span className="truncate font-mono text-[11px] text-faint">{parentFolder(b)}</span>}
                          </span>
                          <ArrowRight
                            aria-hidden
                            className="size-3.5 -translate-x-1 text-faint opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100"
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
        {!editing && prefs.readingShowToc && toc.length > 1 && <Toc headings={toc} />}
      </article>
    </div>
  );
}

/** "On this page", following the reader: the section in view is marked. */
function Toc({ headings }: { headings: Heading[] }) {
  const [active, setActive] = useState(headings[0]?.id);
  useEffect(() => {
    const els = headings.map((h) => document.getElementById(h.id)).filter((el): el is HTMLElement => !!el);
    // The last heading above the top quarter of the window is the current section.
    const update = () => {
      const line = window.innerHeight * 0.25;
      let current = els[0]?.id;
      for (const el of els) if (el.getBoundingClientRect().top <= line) current = el.id;
      setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [headings]);

  return (
    <aside className="no-print absolute top-0 left-full ml-8 hidden h-full w-40 animate-in duration-500 fade-in min-[1260px]:block min-[1400px]:ml-12 min-[1400px]:w-48">
      <nav aria-label="On this page" className="sticky top-24">
        <p className="kicker mb-3">On this page</p>
        <ul className="flex flex-col border-l text-[13px]">
          {headings.map((h) => (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                aria-current={h.id === active ? "location" : undefined}
                style={{ paddingLeft: `${(h.depth - 1) * 0.75 + 0.85}rem` }}
                className={`-ml-px block border-l py-1 leading-snug transition-colors duration-200 ${
                  h.id === active ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
