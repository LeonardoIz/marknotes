"use client";

import {
  autocompletion,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  dropCursor,
  EditorView,
  keymap,
  MatchDecorator,
  placeholder,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { SyntaxNode } from "@lezer/common";
import { useEffect, useRef } from "react";
import { toast } from "./ui";
import { fold, noteName } from "@/lib/parse";

/** Markdown stays visible as syntax, but styled: big headings, bold, italics, muted markup. */
const markdownStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: "2em", fontFamily: "var(--font-serif)" },
  { tag: t.heading2, fontSize: "1.65em", fontFamily: "var(--font-serif)" },
  { tag: t.heading3, fontSize: "1.3em", fontFamily: "var(--font-serif)" },
  { tag: t.heading4, fontSize: "1.1em", fontFamily: "var(--font-serif)" },
  { tag: [t.heading5, t.heading6], fontFamily: "var(--font-serif)", fontStyle: "italic" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--brand)" },
  { tag: t.monospace, fontFamily: "var(--font-mono)", fontSize: "0.86em" },
  { tag: t.quote, color: "var(--muted-foreground)", fontFamily: "var(--font-serif)", fontStyle: "italic" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--faint)" },
  // Tokens inside fenced code blocks
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "var(--c-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--c-string)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--c-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--faint)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.typeName, t.className], color: "var(--c-function)" },
  { tag: [t.tagName, t.attributeName], color: "var(--c-string)" },
]);

const codeLine = Decoration.line({ class: "cm-codeblock" });

/** Monospace + soft background on every line of a fenced code block. */
const codeBlocks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView) {
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            if (node.name !== "FencedCode") return;
            for (let pos = node.from; pos <= node.to; ) {
              const line = view.state.doc.lineAt(pos);
              builder.add(line.from, line.from, codeLine);
              pos = line.to + 1;
            }
            return false;
          },
        });
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

/** [[links]] and #tags in the accent, as they will read once rendered. */
const wikilinkMark = Decoration.mark({ class: "cm-wikilink" });
const tagMark = Decoration.mark({ class: "cm-tag" });
const noteMarkDecorator = new MatchDecorator({
  regexp: /\[\[[^[\]\n]+\]\]|(?<=^|\s)#[\p{L}\p{N}_/-]*[\p{L}_][\p{L}\p{N}_/-]*/gu,
  decoration: (match) => (match[0].startsWith("[[") ? wikilinkMark : tagMark),
});
const noteMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = noteMarkDecorator.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = noteMarkDecorator.updateDeco(update, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

async function upload(file: File): Promise<string | null> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/attachments", { method: "POST", body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast(data.error ?? "Upload failed.", "error");
    return null;
  }
  const url = `attachments/${encodeURIComponent(data.name)}`;
  return /^(image|video|audio)\//.test(file.type) ? `![${data.name}](${url})` : `[${data.name}](${url})`;
}

function insertUploads(view: EditorView, files: FileList | undefined | null, pos?: number) {
  const list = [...(files ?? [])];
  if (!list.length) return false;
  toast(list.length === 1 ? "Uploading…" : `Uploading ${list.length} files…`);
  Promise.all(list.map(upload)).then((links) => {
    const text = links.filter(Boolean).join("\n");
    if (!text) return;
    const at = pos ?? view.state.selection.main.head;
    view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } });
    toast("Uploaded ✓");
  });
  return true;
}

/* ---------- Completion: [[ suggests note titles, # suggests tags ---------- */

const cached = <T,>(url: string) => {
  let value: Promise<T[]> | null = null;
  let at = 0;
  return () => {
    // Refetched after 30 s, so notes and tags created meanwhile show up.
    if (!value || Date.now() - at > 30_000) {
      at = Date.now();
      value = fetch(url).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    }
    return value;
  };
};
const titles = cached<string>("/api/titles");
const tags = cached<string>("/api/tags");

const inCode = (context: CompletionContext) => {
  for (let node: SyntaxNode | null = syntaxTree(context.state).resolveInner(context.pos, -1); node; node = node.parent) {
    if (/Code|CodeText|FencedCode|InlineCode|CodeBlock/.test(node.name)) return true;
  }
  return false;
};

async function completeLinks(context: CompletionContext): Promise<CompletionResult | null> {
  const match = context.matchBefore(/\[\[[^[\]\n|#]*/);
  if (!match || inCode(context)) return null;
  const closed = context.state.sliceDoc(context.pos, context.pos + 2) === "]]";
  const all = await titles();
  const names = new Map<string, number>();
  for (const t of all) names.set(fold(noteName(t)), (names.get(fold(noteName(t))) ?? 0) + 1);
  return {
    from: match.from + 2,
    options: all.map((title) => {
      // [[Name]] when that name is unique, the full path when two folders share it.
      const link = names.get(fold(noteName(title))) === 1 ? noteName(title) : title;
      return { label: title, apply: closed ? link : `${link}]]`, type: "text" };
    }),
    validFor: /^[^[\]\n|#]*$/,
  };
}

async function completeTags(context: CompletionContext): Promise<CompletionResult | null> {
  // A # at the start of a word, with at least one letter typed (a bare "# " is a heading).
  const match = context.matchBefore(/(?:^|[\s(])#[\p{L}\p{N}_/-]+/u);
  if (!match || inCode(context)) return null;
  const from = match.from + match.text.indexOf("#") + 1;
  return {
    from,
    options: (await tags()).map((tag) => ({ label: tag, detail: "tag", type: "keyword" })),
    validFor: /^[\p{L}\p{N}_/-]*$/u,
  };
}

export type EditorHandle = { setText: (text: string) => void };

export default function Editor({
  initial,
  autoFocus = true,
  font = "sans",
  spellcheck = true,
  onChange,
  onSave,
  onExit,
  onReady,
}: {
  initial: string;
  /** Hands over a way to change the text from outside (e.g. a task ticked in the preview), as one undoable edit. */
  onReady?: (handle: EditorHandle | null) => void;
  /** A new note focuses its title instead. */
  autoFocus?: boolean;
  font?: "sans" | "mono";
  spellcheck?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onExit: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  // Latest callbacks without recreating the editor.
  const handlers = useRef({ onChange, onSave, onExit, onReady });
  useEffect(() => {
    handlers.current = { onChange, onSave, onExit, onReady };
  });

  useEffect(() => {
    const run = (fn: "onSave" | "onExit") => () => (handlers.current[fn](), true);
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          drawSelection(),
          dropCursor(),
          EditorView.lineWrapping,
          placeholder("Start writing… Markdown works here."),
          yamlFrontmatter({ content: markdown({ base: markdownLanguage, codeLanguages: languages }) }),
          syntaxHighlighting(markdownStyle),
          codeBlocks,
          noteMarks,
          autocompletion({ override: [completeLinks, completeTags], icons: false, activateOnTypingDelay: 60 }),
          keymap.of([
            ...completionKeymap,
            { key: "Mod-s", run: run("onSave"), preventDefault: true },
            { key: "Mod-Enter", run: run("onSave") },
            { key: "Escape", run: run("onExit") },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((u) => u.docChanged && handlers.current.onChange(u.state.doc.toString())),
          EditorView.domEventHandlers({
            paste: (e, view) => insertUploads(view, e.clipboardData?.files) && (e.preventDefault(), true),
            drop: (e, view) => {
              const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? undefined;
              return insertUploads(view, e.dataTransfer?.files, pos) && (e.preventDefault(), true);
            },
          }),
          EditorView.contentAttributes.of({ "aria-label": "Note content", spellcheck: spellcheck ? "true" : "false" }),
          EditorView.editorAttributes.of({ class: font === "mono" ? "font-mono" : "" }),
        ],
      }),
    });
    if (autoFocus) view.focus();
    handlers.current.onReady?.({
      setText(next) {
        // Replace only what differs, so the cursor and undo history stay meaningful.
        const doc = view.state.doc.toString();
        let start = 0;
        while (start < doc.length && start < next.length && doc[start] === next[start]) start++;
        let end = 0;
        while (end < doc.length - start && end < next.length - start && doc[doc.length - 1 - end] === next[next.length - 1 - end]) end++;
        if (start === doc.length && start === next.length) return;
        view.dispatch({ changes: { from: start, to: doc.length - end, insert: next.slice(start, next.length - end) } });
      },
    });
    return () => {
      handlers.current.onReady?.(null);
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor owns its document after mount
  }, []);

  return <div ref={host} className="min-h-[60vh] flex-1" />;
}
