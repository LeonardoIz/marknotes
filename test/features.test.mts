import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-features-"));
process.env.NOTES_PATH = dir;
const notes = await import("../src/lib/notes.ts");
const db = await import("../src/lib/db.ts");
const { toggleTask } = await import("../src/lib/tasks.ts");

after(() => fs.rm(dir, { recursive: true, force: true }));

test("settings: defaults, validated updates, unknown keys refused", () => {
  assert.equal(db.getSettings().homeRecentCount, 8);
  assert.equal(db.updateSettings({ homeRecentCount: 3, editorFont: "mono" }).homeRecentCount, 3);
  assert.equal(db.getSettings().editorFont, "mono");
  assert.throws(() => db.updateSettings({ homeRecentCount: -1 }));
  assert.throws(() => db.updateSettings({ nope: true }));
});

test("pins follow a rename and go away with the note", async () => {
  await notes.createNote("Plan", "x");
  db.setPinned("Plan", true);
  await notes.updateNote("Plan", { newTitle: "Plan B" });
  assert.deepEqual(db.listPins(), ["Plan B"]);
  await notes.deleteNote("Plan B");
  assert.deepEqual(db.listPins(), []);
});

test("views are saved and removed", () => {
  const view = db.createView({ name: "Work", query: "#work", sort: "modified" });
  assert.deepEqual(db.listViews().map((v) => v.name), ["Work"]);
  assert.throws(() => db.createView({ name: "", query: "x" }));
  assert.equal(db.deleteView(view.id), true);
});

test("trash: list, restore without overwriting, delete, purge", async () => {
  const [item] = await notes.listTrash();
  assert.equal(item.title, "Plan B");
  assert.ok(Date.now() - item.deletedAt < 60_000);

  await notes.createNote("Plan B", "a newer note with the same title");
  assert.equal(await notes.restoreFromTrash(item.name), "Plan B (restored)");
  assert.equal((await notes.getNote("Plan B")).content, "a newer note with the same title");

  await notes.deleteNote("Plan B (restored)");
  await notes.deleteNote("Plan B");
  assert.equal((await notes.listTrash()).length, 2);
  await assert.rejects(notes.deleteFromTrash("../Plan B.md"), { status: 400 });
  assert.equal(await notes.purgeTrash({ olderThanDays: 1 }), 0);
  assert.equal(await notes.purgeTrash({ all: true }), 2);
});

test("attachments know which notes use them", async () => {
  await notes.saveAttachment("my pic.png", new Uint8Array([1, 2, 3]));
  await notes.saveAttachment("unused.pdf", new Uint8Array([1]));
  await notes.createNote("Photo", "![x](attachments/my%20pic.png)");
  const list = await notes.listAttachments();
  assert.deepEqual(list.find((a) => a.name === "my pic.png")?.usedBy, ["Photo"]);
  assert.deepEqual(list.find((a) => a.name === "unused.pdf")?.usedBy, []);
  await notes.deleteAttachment("unused.pdf");
  await assert.rejects(notes.deleteAttachment("unused.pdf"), { status: 404 });
});

test("tasks toggle by rendered order, skipping code and frontmatter", () => {
  const md = "---\ntags: [x]\n---\n- [ ] one\n\n```\n- [ ] not a task\n```\n\n1. [x] two\n   - [ ] three";
  assert.equal(toggleTask(md, 0, true), md.replace("- [ ] one", "- [x] one"));
  assert.equal(toggleTask(md, 1, false), md.replace("1. [x] two", "1. [ ] two"));
  assert.equal(toggleTask(md, 2, true), md.replace("- [ ] three", "- [x] three"));
  assert.throws(() => toggleTask(md, 3, true), RangeError);
});

test("folders: notes in paths, listing, rename/move with pins, empty-only delete, trash keeps the folder", async () => {
  await notes.createNote(" Work / Weekly ", "w");
  await notes.createFolder("Empty/Inner");
  assert.ok((await notes.listNotes()).some((n) => n.title === "Work/Weekly"));
  assert.deepEqual(await notes.listFolders(), ["Empty", "Empty/Inner", "Work"]);
  await assert.rejects(notes.createNote("attachments/x", ""), { status: 400 });
  await assert.rejects(notes.createNote("Work/../x", ""), { status: 400 });
  await assert.rejects(notes.getNote("../x"), { status: 400 });

  db.setPinned("Work/Weekly", true);
  await notes.renameFolder("Work", "Archive/Work");
  assert.equal((await notes.getNote("Archive/Work/Weekly")).content, "w");
  assert.ok(db.listPins().includes("Archive/Work/Weekly"));
  await assert.rejects(notes.renameFolder("Archive", "Archive/Work/Deeper"), { status: 400 });

  await assert.rejects(notes.deleteFolder("Archive"), { status: 409 });
  await notes.deleteFolder("Empty/Inner");
  await notes.deleteFolder("Empty");

  // Moving the last note out of a folder removes the folder; the trash remembers where a note was.
  await notes.updateNote("Archive/Work/Weekly", { newTitle: "Weekly" });
  assert.deepEqual(await notes.listFolders(), []);
  await notes.updateNote("Weekly", { newTitle: "Team/Weekly" });
  await notes.deleteNote("Team/Weekly");
  const [item] = (await notes.listTrash()).filter((t) => t.title === "Team/Weekly");
  assert.ok(item);
  assert.equal(await notes.restoreFromTrash(item.name), "Team/Weekly");
  assert.equal((await notes.getNote("Team/Weekly")).content, "w");
});

test("export holds every note in its folder and the attachments, nothing else", async () => {
  await notes.saveAttachment("pic.png", new Uint8Array([1, 2, 3]));
  const files = new Map(await notes.exportFiles());
  assert.ok(files.has("Team/Weekly.md"));
  assert.deepEqual([...files.get("attachments/pic.png")!], [1, 2, 3]);
  assert.ok(![...files.keys()].some((k) => k.startsWith(".")));
});

test("templates and the daily note", async () => {
  const { applyTemplate, formatTime, parseLocalTime } = await import("../src/lib/templates.ts");
  const now = parseLocalTime("2026-03-04T05:06:07")!;
  assert.equal(formatTime("YYYY-MM-DD [at] HH:mm", now), "2026-03-04 at 05:06");
  assert.equal(applyTemplate("{{title}} {{date}} {{time}} {{date:D/M/YY}} {{other}}", { title: "T", now }), "T 2026-03-04 05:06 4/3/26 {{other}}");
  assert.equal(parseLocalTime("2026-02-30T00:00:00"), null);

  const daily = await import("../src/lib/daily.ts");
  await notes.createNote("Templates/Day", "# {{title}}\n");
  db.updateSettings({ dailyTemplate: "Day", dailyFolder: "Journal", dailyFormat: "YYYY/MM-DD" });
  const first = await daily.openDaily(now);
  assert.deepEqual([first.created, first.note.title, first.note.content], [true, "Journal/2026/03-04", "# 03-04\n"]);
  assert.equal((await daily.openDaily(now)).created, false);
  assert.deepEqual((await daily.listTemplates()).map((t) => t.name), ["Day"]);
  db.updateSettings({ dailyFormat: "[bad:]YYYY" });
  assert.throws(() => daily.dailyTitle(now), { status: 400 });
  db.updateSettings({ dailyFormat: "YYYY-MM-DD", dailyFolder: "Daily", dailyTemplate: "" });
});

test("links resolve by path or name, nearest folder first", async () => {
  const { linkResolver } = await import("../src/lib/parse.ts");
  const resolve = linkResolver(["Work/Weekly", "Home/Weekly", "Ideas", "Work/Deep/Plan"]);
  assert.equal(resolve("Ideas"), "Ideas");
  assert.equal(resolve("weekly", "Home/Today"), "Home/Weekly");
  assert.equal(resolve("Weekly", "Work/Other"), "Work/Weekly");
  assert.equal(resolve("Weekly"), "Home/Weekly"); // same depth: alphabetical
  assert.equal(resolve("Deep/Plan"), "Work/Deep/Plan");
  assert.equal(resolve("Plan"), "Work/Deep/Plan");
  assert.equal(resolve("Missing"), null);
});

test("search by meaning ranks by the closest passage (with a stand-in model)", async () => {
  const semantic = await import("../src/lib/semantic.ts");
  // A toy model: one dimension per topic word.
  const topics = ["pan", "harina", "reunión", "equipo"];
  semantic.useEmbedder(async (texts) =>
    texts.map((t) => {
      const v = new Float32Array([...topics.map((w) => (t.toLowerCase().includes(w) ? 1 : 0)), 0.05]);
      const n = Math.hypot(...v);
      return v.map((x) => x / n);
    }),
  );
  await notes.createNote("Recetas/Pan", "Pan de masa madre.\n\nMezclar harina y agua.");
  await notes.createNote("Reunión", "La reunión del equipo es los lunes.");
  assert.equal(await semantic.semanticSearch("pan"), null, "not ready on the very first call");
  await semantic.syncEmbeddings();
  const hits = (await semantic.semanticSearch("harina para pan"))!;
  assert.equal(hits[0].title, "Recetas/Pan");
  assert.ok(!hits.some((h) => h.title === "Reunión"));
  assert.deepEqual(semantic.chunkNote("A/B", "---\nx: 1\n---\nUno.\n\nDos."), ["B\nUno. Dos."]);

  // Edits are picked up; deleted notes leave the index.
  await notes.deleteNote("Recetas/Pan");
  assert.ok(!(await semantic.semanticSearch("pan"))!.some((h) => h.title === "Recetas/Pan"));
});

test("one search: words and meaning fused, notes found both ways first, #tags filter both", async () => {
  const { findNotes } = await import("../src/lib/find.ts");
  await notes.createNote("Masa", "Receta de masa con harina #cocina");
  await notes.createNote("Harina integral", "Harina de trigo integral, molida en piedra.");
  await notes.createNote("Pan dulce", "Brioche con mantequilla y harina #cocina");
  const { hits, meaning } = await findNotes("masa con harina");
  assert.equal(meaning, "in");
  assert.equal(hits[0].title, "Masa", "found by words and by meaning");
  assert.ok(hits.some((h) => h.title === "Harina integral"), "found by meaning only");
  const tagged = await findNotes("#cocina harina");
  assert.ok(tagged.hits.every((h) => h.tags.includes("cocina")));
  assert.equal((await findNotes("pa")).meaning, "off", "too short to search by meaning");
});
