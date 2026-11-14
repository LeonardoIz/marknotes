import rehypeShiki from "@shikijs/rehype";
import { transformerNotationDiff, transformerNotationHighlight } from "@shikijs/transformers";
import type { Element, ElementContent, Root as HastRoot } from "hast";
import { toString as hastToString } from "hast-util-to-string";
import type { Blockquote, Root as MdastRoot, Text } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import rehypeExternalLinks from "rehype-external-links";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkBreaks from "remark-breaks";
import remarkEmoji from "remark-emoji";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import remarkSmartypants from "remark-smartypants";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { fold, noteHref, noteName, splitFrontmatter, WIKILINK, type LinkResolver } from "./parse";

export type Heading = { depth: number; id: string; text: string };
export type Rendered = { html: string; headings: Heading[]; readingMinutes: number };

const TAG = /(?<=^|\s)#([\p{L}\p{N}_/-]*[\p{L}_][\p{L}\p{N}_/-]*)/gu;
const ALERTS = { NOTE: "Note", TIP: "Tip", IMPORTANT: "Important", WARNING: "Warning", CAUTION: "Caution" };
const VIDEO = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
const AUDIO = /\.(mp3|ogg|oga|wav|m4a|flac)(\?|#|$)/i;

/** Wikilinks, #tags, GitHub alerts and ```mermaid fences, on the markdown tree. */
function remarkNotes({ resolve, title }: { resolve: LinkResolver; title?: string }) {
  return (tree: MdastRoot) => {
    // A note that opens with "# <its own title>" would show the title twice under the page heading.
    const first = tree.children.find((n) => n.type !== "yaml");
    if (title && first?.type === "heading" && first.depth === 1) {
      const text = first.children.map((c) => ("value" in c ? c.value : "")).join("");
      if (fold(text.trim()) === fold(noteName(title).trim())) tree.children.splice(tree.children.indexOf(first), 1);
    }

    findAndReplace(
      tree,
      [
        [
          WIKILINK,
          (_: string, target: string, heading: string | undefined, alias: string | undefined) => {
            const linked = target.trim();
            const found = resolve(linked, title);
            const hash = heading ? `#${heading.slice(1).trim().toLowerCase().replace(/\s+/g, "-")}` : "";
            return {
              type: "link",
              url: noteHref(found ?? linked) + hash,
              children: [{ type: "text", value: (alias ?? (heading ? `${linked} › ${heading.slice(1)}` : linked)).trim() }],
              data: { hProperties: { className: found ? ["wikilink"] : ["wikilink", "wikilink-missing"] } },
            };
          },
        ],
        [
          TAG,
          (match: string, tag: string) => ({
            type: "link",
            url: `/search?q=${encodeURIComponent(`#${tag.toLowerCase()}`)}`,
            children: [{ type: "text", value: match }],
            data: { hProperties: { className: ["tag"] } },
          }),
        ],
      ],
      { ignore: ["link", "linkReference"] },
    );

    visit(tree, "blockquote", (node: Blockquote) => {
      const first = node.children[0];
      if (first?.type !== "paragraph" || first.children[0]?.type !== "text") return;
      const text = first.children[0] as Text;
      const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(text.value);
      if (!match) return;
      const kind = match[1].toUpperCase() as keyof typeof ALERTS;
      text.value = text.value.slice(match[0].length);
      if (!text.value && first.children[1]?.type === "break") first.children.splice(0, 2);
      node.data = { hName: "div", hProperties: { className: ["alert", `alert-${kind.toLowerCase()}`] } };
      node.children.unshift({
        type: "paragraph",
        children: [{ type: "text", value: ALERTS[kind] }],
        data: { hProperties: { className: ["alert-title"] } },
      });
    });

    visit(tree, "code", (node, index, parent) => {
      if (node.lang !== "mermaid" || !parent || index === undefined) return;
      parent.children[index] = {
        type: "mermaid",
        data: { hName: "div", hProperties: { className: ["mermaid"] }, hChildren: [{ type: "text", value: node.value }] },
      } as never;
    });
  };
}

// Raw HTML is allowed but sanitized; classes are harmless and the plugins after this rely on them.
const schema: SanitizeSchema = {
  ...defaultSchema,
  clobber: [], // remark-rehype already prefixes footnote ids; a second prefix breaks their links
  tagNames: [...(defaultSchema.tagNames ?? []), "video", "audio", "source", "mark", "u", "abbr", "kbd"],
  attributes: {
    ...Object.fromEntries(
      Object.entries(defaultSchema.attributes ?? {}).map(([tag, attrs]) => [
        tag,
        attrs.filter((a) => (Array.isArray(a) ? a[0] : a) !== "className"),
      ]),
    ),
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className", "role", "ariaHidden"],
    video: ["src", "controls", "loop", "muted", "poster", "width", "height"],
    audio: ["src", "controls", "loop"],
    source: ["src", "type"],
  },
};

/** Runs before katex so a heading's text is its TeX source, not the rendered MathML. */
function rehypeCollectHeadings(headings: Heading[]) {
  return (tree: HastRoot) => {
    visit(tree, "element", (node: Element) => {
      const depth = /^h([1-6])$/.exec(node.tagName)?.[1];
      const id = node.properties.id;
      if (depth && typeof id === "string" && id !== "footnote-label") {
        headings.push({ depth: Number(depth), id, text: hastToString(node).trim() });
      }
    });
  };
}

/** Fix relative URLs (notes live at /note/<title>), media players, table wrappers, heading anchors. */
function rehypeNotes() {
  return (tree: HastRoot) => {
    visit(tree, "element", (node: Element, index, parent) => {
      for (const prop of ["href", "src"] as const) {
        const url = node.properties[prop];
        if (typeof url === "string" && url && !/^([a-z][a-z0-9+.-]*:|\/|#|\?)/i.test(url)) {
          node.properties[prop] = `/${url.replace(/^\.\//, "")}`;
        }
      }

      if (node.tagName === "img" && typeof node.properties.src === "string") {
        const src = node.properties.src;
        const media = VIDEO.test(src) ? "video" : AUDIO.test(src) ? "audio" : null;
        if (media) {
          node.tagName = media;
          node.properties = { src, controls: true, title: node.properties.alt as string };
        } else {
          node.properties.loading = "lazy";
        }
      }

      if (node.tagName === "table" && parent && index !== undefined && (parent as Element).tagName !== "div") {
        parent.children[index] = {
          type: "element",
          tagName: "div",
          properties: { className: ["table-wrap"] },
          children: [node],
        };
      }

      if (/^h[1-6]$/.test(node.tagName) && typeof node.properties.id === "string" && node.properties.id !== "footnote-label") {
        const id = node.properties.id;
        node.children.push({
          type: "element",
          tagName: "a",
          properties: { href: `#${id}`, className: ["anchor"], ariaLabel: "Link to this section" },
          children: [{ type: "text", value: "#" }],
        } satisfies ElementContent);
      }
    });
  };
}

/** `title`, when given, is the note's own title: a leading H1 repeating it is left out. */
export async function renderMarkdown(markdown: string, resolve: LinkResolver = () => null, title?: string): Promise<Rendered> {
  const headings: Heading[] = [];
  const file = await unified()
    .use(remarkParse)
    .use(remarkFrontmatter)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkBreaks)
    .use(remarkEmoji, { accessible: true })
    .use(remarkSmartypants)
    .use(remarkNotes, { resolve, title })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, schema)
    // Slug before katex, otherwise `## $O(n)$` slugs the MathML text too.
    .use(rehypeSlug)
    .use(rehypeCollectHeadings, headings)
    .use(rehypeKatex)
    .use(rehypeShiki, {
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
      defaultLanguage: "text",
      fallbackLanguage: "text",
      // Without `langs` the plugin preloads every bundled language (~11 s cold start); `lazy` loads the rest on demand.
      langs: [],
      lazy: true,
      transformers: [transformerNotationHighlight(), transformerNotationDiff()],
    })
    .use(rehypeExternalLinks, { target: "_blank", rel: ["noopener", "noreferrer"] })
    .use(rehypeNotes)
    .use(rehypeStringify)
    .process(markdown);

  const words = splitFrontmatter(markdown).body.split(/\s+/).filter(Boolean).length;
  return { html: String(file), headings, readingMinutes: words ? Math.max(1, Math.round(words / 200)) : 0 };
}
