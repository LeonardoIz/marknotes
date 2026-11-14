import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-test-"));
process.env.NOTES_PATH = dir;
const notes = await import("../src/lib/notes.ts");
const { search, allTags, backlinks } = await import("../src/lib/search.ts");
const { extractTags, extractLinks, plainText } = await import("../src/lib/parse.ts");
const { renderMarkdown } = await import("../src/lib/markdown.ts");

after(() => fs.rm(dir, { recursive: true, force: true }));

test("titles are validated", () => {
  for (const bad of ["", "  ", "a//b", "a/../b", "a/.git/b", "a\\b", ".hidden", "x".repeat(300), "a\u0000b", "/".repeat(3)]) {
    assert.throws(() => notes.validateTitle(bad), { status: 400 }, JSON.stringify(bad));
  }
  assert.equal(notes.validateTitle("  Café ideas  "), "Café ideas");
  assert.equal(notes.validateTitle("/Work / Café ideas/"), "Work/Café ideas"); // a / puts it in a folder
});

test("a note made outside the app with a non-portable name can be opened and edited, not created", async () => {
  await fs.writeFile(path.join(dir, "Receta: pan.md"), "harina");
  assert.equal((await notes.getNote("Receta: pan")).content, "harina");
  assert.equal((await notes.updateNote("Receta: pan", { content: "agua" })).content, "agua");
  await assert.rejects(notes.createNote("Otra: receta", "x"), { status: 400 });
  await assert.rejects(notes.getNote("../secret"), { status: 400 });
  await fs.rm(path.join(dir, "Receta: pan.md"));
});

test("create never overwrites, update detects external edits, delete goes to trash", async () => {
  const note = await notes.createNote("Plan", "v1");
  await assert.rejects(notes.createNote("Plan", "other"), { status: 409 });
  assert.equal((await notes.getNote("Plan")).content, "v1");

  await new Promise((r) => setTimeout(r, 20));
  await fs.writeFile(path.join(dir, "Plan.md"), "edited outside");
  await assert.rejects(notes.updateNote("Plan", { content: "mine", baseMtime: note.mtime }), { status: 409 });

  const renamed = await notes.updateNote("Plan", { newTitle: "Plan B", content: "v2" });
  assert.deepEqual([renamed.title, renamed.content], ["Plan B", "v2"]);
  await notes.deleteNote("Plan B");
  assert.equal((await fs.readdir(path.join(dir, ".trash"))).length, 1);
  assert.equal((await fs.readdir(dir)).filter((f) => f.endsWith(".tmp")).length, 0);
});

test("search: accent folding, tags, backlinks, and a broken file does not break it", async () => {
  await notes.createNote("Recetas", "Un buen café #cocina #café [[Plan C]]");
  await notes.createNote("Plan C", "nothing");
  await fs.writeFile(path.join(dir, "Binary.md"), Buffer.from([0xff, 0xfe, 0x00]));

  assert.deepEqual((await search("cafe")).map((h) => h.title), ["Recetas"]);
  assert.deepEqual((await search("#café")).map((h) => h.title), ["Recetas"]);
  assert.ok((await allTags()).includes("café"));
  assert.deepEqual(await backlinks("Plan C"), ["Recetas"]);
  assert.equal((await search("*")).length, 3);
});

test("tags and links ignore code, accept frontmatter and Unicode", () => {
  const md = "---\ntags: [Work]\n---\n#idea #año #123 `#nope`\n```\n#nope [[Nope]]\n```\n[[Yes|alias]] [[Yes#h]]";
  assert.deepEqual(extractTags(md), ["año", "idea", "work"]);
  assert.deepEqual(extractLinks(md), ["Yes"]);
});

test("plain text for search drops the repeated title heading and keeps snake_case", () => {
  assert.equal(plainText("---\ntags: [a]\n---\n# Róadmap\nCall _search_notes_ **now**", "Roadmap"), "Call search_notes now");
  assert.equal(plainText("# Other\ntext", "Roadmap"), "Other text");
});

test("rendering sanitizes HTML but keeps the rich features", async () => {
  const { html } = await renderMarkdown(
    '<img src=x onerror=alert(1)><script>alert(2)</script>[x](javascript:alert(3))\n\n> [!TIP]\n> hi\n\n$x^2$\n\n```mermaid\nA-->B\n```',
  );
  assert.doesNotMatch(html, /onerror|<script|javascript:/);
  assert.match(html, /class="alert alert-tip"/);
  assert.match(html, /class="katex"/);
  const code = (await renderMarkdown("```ts\nconst a = 1;\n```")).html;
  const titled = await renderMarkdown("---\ntags: [x]\n---\n# Plan B\n\ntext\n\n# Plan B", () => null, "plan b");
  assert.equal((titled.html.match(/<h1/g) ?? []).length, 1, "only the leading H1 repeating the title is dropped");
  assert.match(code, /<pre class="shiki/);
  assert.match(code, /style="--shiki-light:#D73A49[^"]*">const</i); // keyword colored: the TS grammar loaded on demand
  assert.match(html, /<div class="mermaid">A--&#x3E;B<\/div>|<div class="mermaid">A-->B<\/div>/);
});
