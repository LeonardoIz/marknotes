"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** Server-rendered note HTML plus the bits that need the browser: copy buttons, Mermaid, client-side links. */
export function Rendered({
  html,
  onToggleTask,
}: {
  html: string;
  /** When given, task checkboxes are clickable; resolves false if the change didn't stick. */
  onToggleTask?: (index: number, checked: boolean) => Promise<boolean>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const toggleRef = useRef(onToggleTask);
  useEffect(() => {
    toggleRef.current = onToggleTask;
  });
  const interactive = !!onToggleTask;

  useEffect(() => {
    if (!interactive) return;
    const boxes = [...ref.current!.querySelectorAll<HTMLInputElement>(
      // A loose list (blank lines between items) wraps each item's text, box included, in a <p>.
      "li.task-list-item > input[type=checkbox], li.task-list-item > p:first-child > input[type=checkbox]",
    )];
    const cleanups = boxes.map((box, index) => {
      box.disabled = false;
      box.classList.add("task-toggle");
      box.setAttribute("aria-label", "Toggle task");
      const onChange = async () => {
        box.disabled = true;
        const ok = await toggleRef.current?.(index, box.checked);
        if (!ok) box.checked = !box.checked;
        box.disabled = false;
      };
      box.addEventListener("change", onChange);
      return () => box.removeEventListener("change", onChange);
    });
    return () => cleanups.forEach((c) => c());
  }, [html, interactive]);

  useEffect(() => {
    const root = ref.current!;
    for (const pre of root.querySelectorAll<HTMLPreElement>("pre.shiki")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "copy-code";
      button.textContent = "Copy";
      button.onclick = async () => {
        await navigator.clipboard.writeText(pre.querySelector("code")?.innerText ?? "");
        button.textContent = "Copied ✓";
        setTimeout(() => (button.textContent = "Copy"), 1500);
      };
      pre.append(button);
    }

    const diagrams = [...root.querySelectorAll<HTMLElement>(".mermaid")];
    if (!diagrams.length) return;
    for (const d of diagrams) d.dataset.source ??= d.textContent ?? "";
    // Mermaid bakes colors into its SVG, so a theme change draws the diagrams again.
    const draw = () =>
      import("mermaid").then(({ default: mermaid }) => {
        for (const d of diagrams) {
          d.removeAttribute("data-processed");
          d.textContent = d.dataset.source ?? "";
        }
        // The resolved family, not var(--font-sans): Mermaid measures labels with it to size the boxes.
        const fontFamily = getComputedStyle(document.body).fontFamily;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          look: "classic",
          fontFamily,
          themeVariables: { ...mermaidColors(), fontFamily },
          themeCSS: DIAGRAM_CSS,
          flowchart: { curve: "basis", padding: 14, nodeSpacing: 40, rankSpacing: 48 },
          sequence: { actorMargin: 60, mirrorActors: false, messageFontSize: 13, actorFontSize: 13, noteFontSize: 12 },
        });
        return mermaid.run({ nodes: diagrams }).catch((error) => console.error("mermaid:", error));
      });
    draw();
    const media = matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener("notes:theme", draw);
    media.addEventListener("change", draw);
    return () => {
      window.removeEventListener("notes:theme", draw);
      media.removeEventListener("change", draw);
    };
  }, [html]);

  const onClick = (e: React.MouseEvent) => {
    const link = (e.target as HTMLElement).closest("a");
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || link.target) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith("/attachments/")) return;
    if (url.pathname === location.pathname && url.hash) return; // in-page anchor: let the browser scroll
    e.preventDefault();
    router.push(url.pathname + url.search + url.hash);
  };

  return <div ref={ref} className="markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Mermaid's palette from the page's own tokens (it can't read CSS variables). */
function mermaidColors() {
  // Tokens are light-dark(): resolve them by reading a computed color.
  const probe = document.createElement("span");
  document.body.append(probe);
  const color = (name: string) => {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };
  const colors = {
    background: color("--background"),
    primaryColor: color("--card"),
    primaryTextColor: color("--foreground"),
    primaryBorderColor: color("--border"),
    lineColor: color("--muted-foreground"),
    secondaryColor: color("--secondary"),
    tertiaryColor: color("--background"),
    textColor: color("--foreground"),
    mainBkg: color("--card"),
    nodeBorder: color("--border"),
    clusterBkg: color("--secondary"),
    edgeLabelBackground: color("--background"),
    fontSize: "13px",
    // Series colors (pie, gantt, git, ...): the accent first, then the status tones.
    pie1: color("--brand"),
    pie2: color("--info"),
    pie3: color("--ok"),
    pie4: color("--warn"),
    pie5: color("--muted-foreground"),
    pie6: color("--destructive"),
    git0: color("--brand"),
    git1: color("--info"),
    git2: color("--ok"),
    git3: color("--warn"),
    noteBkgColor: color("--card"),
    noteBorderColor: color("--brand"),
    noteTextColor: color("--foreground"),
    actorBkg: color("--card"),
    actorBorder: color("--border"),
    actorTextColor: color("--foreground"),
    signalColor: color("--muted-foreground"),
    signalTextColor: color("--foreground"),
  };
  probe.remove();
  return colors;
}

/* Diagrams using the app’s theme, drawn with the page's own tokens (the SVG is inline, so the CSS
   variables resolve and follow the theme): card-colored boxes with hairline borders, thin muted
   lines, small mono labels, no shadows. A diagram's own `style`/`classDef` still wins: those are inline. */
const DIAGRAM_CSS = `
  * { filter: none !important; }
  .node rect, .node polygon, .node circle, .node ellipse, .node path,
  .actor, rect.actor, .classGroup rect, .stateGroup rect, .statediagram-state rect, .er.entityBox {
    fill: var(--card); stroke: var(--border); stroke-width: 1px;
  }
  .node rect, rect.actor, .statediagram-state rect { rx: 3px; ry: 3px; }
  .nodeLabel, .label, .label text, .actor tspan, text.actor, .messageText, .noteText, .classTitle, .stateLabel {
    color: var(--foreground); fill: var(--foreground);
  }
  .flowchart-link, .edgePath .path, .messageLine0, .messageLine1, .relation, .transition, path.relationshipLine {
    stroke: var(--muted-foreground) !important; stroke-width: 1px;
  }
  .arrowheadPath, marker path, .arrowhead, #arrowhead path, .marker { fill: var(--muted-foreground); stroke: var(--muted-foreground); }
  .edgeLabel, .edgeLabel p, .edgeLabel rect, .labelBkg {
    background-color: var(--background) !important; fill: var(--background) !important;
    color: var(--muted-foreground); font-family: var(--font-mono); font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .cluster rect { fill: transparent !important; stroke: var(--border) !important; stroke-dasharray: 3 3; rx: 3px; }
  .cluster-label .nodeLabel, .cluster span { color: var(--muted-foreground); font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; }
  .note, rect.note { fill: color-mix(in srgb, var(--brand) 8%, var(--card)); stroke: color-mix(in srgb, var(--brand) 45%, transparent); }
  .actor-line { stroke: var(--rule); }
  .loopLine { stroke: var(--border); }
  .labelBox { fill: var(--secondary); stroke: var(--border); }
  .loopText, .labelText, .labelText > tspan { fill: var(--muted-foreground); font-family: var(--font-mono); font-size: 11px; }
  .pieCircle { stroke: var(--background); stroke-width: 2px; }
  .pieTitleText, .titleText { fill: var(--foreground); font-family: var(--font-serif); }
  .legend text, .pieOuterCircle { fill: var(--muted-foreground); stroke: none; }
`;
