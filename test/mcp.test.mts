import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-mcp-test-"));
process.env.NOTES_PATH = dir;
const access = await import("../src/lib/access.ts");
const db = await import("../src/lib/db.ts");
access.saveAccess(access.buildAccess(access.accessInput.parse({ mode: "password", username: "me", password: "a-long-password" }), null));
db.updateSettings({ mcpEnabled: true });
const TOKEN = db.createMcpToken({ name: "Test agent" }).token;
const { POST } = await import("../src/app/api/mcp/route.ts");

after(() => fs.rm(dir, { recursive: true, force: true }));

let id = 0;
async function rpc(method: string, params: object = {}, token = TOKEN) {
  const res = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    }),
  );
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

const call = async (name: string, args: object) => (await rpc("tools/call", { name, arguments: args })).body.result;

test("rejects a wrong token", async () => {
  assert.equal((await rpc("tools/list", {}, "nope")).status, 401);
});

test("initializes and lists the tools", async () => {
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  assert.equal(init.body.result.serverInfo.name, "marknotes");
  const tools = (await rpc("tools/list")).body.result.tools.map((t: { name: string }) => t.name);
  assert.deepEqual(tools.sort(), [
    "append_to_note",
    "create_folder",
    "create_note",
    "daily_note",
    "delete_note",
    "list_folders",
    "list_tags",
    "list_templates",
    "read_note",
    "search_by_meaning",
    "search_notes",
    "update_note",
  ]);
});

test("create, search, read, conflict-safe update, append", async () => {
  await call("create_note", { title: "Ideas", content: "Un café #proyecto" });
  const found = JSON.parse((await call("search_notes", { query: "cafe" })).content[0].text);
  assert.equal(found[0].title, "Ideas");

  const read = await call("read_note", { title: "Ideas" });
  const meta = JSON.parse(read.content[0].text);
  assert.deepEqual(meta.tags, ["proyecto"]);
  assert.equal(read.content[1].text, "Un café #proyecto");

  await new Promise((r) => setTimeout(r, 20));
  await fs.writeFile(path.join(dir, "Ideas.md"), "changed by hand");
  const stale = await call("update_note", { title: "Ideas", content: "x", expected_modified_ms: meta.modified_ms });
  assert.equal(stale.isError, true);

  await call("append_to_note", { title: "Ideas", text: "- more" });
  assert.equal(await fs.readFile(path.join(dir, "Ideas.md"), "utf8"), "changed by hand\n\n- more");

  const missing = await call("read_note", { title: "Nope" });
  assert.equal(missing.isError, true);
});

test("folders, templates, the daily note and notes as resources", async () => {
  await call("create_note", { title: "Templates/Meeting", content: "# {{title}}\nOn {{date:DD/MM/YYYY}}" });
  const made = await call("create_note", { title: "Work/Kickoff", template: "Meeting", content: "Notes", local_time: "2026-11-13T09:30:00" });
  assert.equal(made.isError, undefined);
  assert.equal(await fs.readFile(path.join(dir, "Work", "Kickoff.md"), "utf8"), "# Kickoff\nOn 13/11/2026\n\nNotes");

  const folders = JSON.parse((await call("list_folders", {})).content[0].text);
  assert.deepEqual(folders, [{ folder: "Templates", notes: 1 }, { folder: "Work", notes: 1 }]);
  const inWork = JSON.parse((await call("search_notes", { query: "*", folder: "Work" })).content[0].text);
  assert.deepEqual(inWork.map((h: { title: string }) => h.title), ["Work/Kickoff"]);

  const day = await call("daily_note", { append: "- standup", local_time: "2026-11-13T10:00:00" });
  assert.equal(JSON.parse(day.content[0].text).title, "Daily/2026-11-13");
  assert.equal(day.content[1].text, "- standup");

  const listed = (await rpc("resources/templates/list")).body.result.resourceTemplates;
  assert.equal(listed[0].uriTemplate, "note:///{+path}");
  const resources = (await rpc("resources/list")).body.result.resources.map((r: { uri: string }) => r.uri);
  assert.ok(resources.includes("note:///Work/Kickoff"));
  const read = (await rpc("resources/read", { uri: "note:///Work/Kickoff" })).body.result.contents[0];
  assert.match(read.text, /^# Kickoff/);
});

test("agent tokens: each its own, revocable, read-only ones can't write", async () => {
  const reader = db.createMcpToken({ name: "Reader", readOnly: true });
  const tools = (await rpc("tools/list", {}, reader.token)).body.result.tools.map((t: { name: string }) => t.name);
  assert.ok(tools.includes("read_note") && !tools.includes("create_note"));
  assert.ok(db.listMcpTokens().find((t) => t.id === reader.id)?.lastUsedAt);
  assert.ok(!JSON.stringify(db.listMcpTokens()).includes(reader.token), "the secret is never listed");
  db.deleteMcpToken(reader.id);
  assert.equal((await rpc("tools/list", {}, reader.token)).status, 401);
});

test("without a token: 401 pointing at the sign-in metadata; off means not found", async () => {
  const res = await POST(new Request("http://notes.test/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /resource_metadata="http:\/\/notes\.test\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
  db.updateSettings({ mcpEnabled: false });
  assert.equal((await rpc("tools/list")).status, 404);
  db.updateSettings({ mcpEnabled: true });
});

test("OAuth: register, allow, trade the code with PKCE, use, refresh, disconnect", async () => {
  const oauth = await import("../src/lib/oauth.ts");
  const { createHash } = await import("node:crypto");
  assert.throws(() => oauth.registerClient({ redirect_uris: ["http://evil.example/cb"] }), /redirect_uris/);
  const client = oauth.registerClient({ client_name: "Claude Code", redirect_uris: ["http://localhost:4567/callback"] });
  const verifier = "v".repeat(50);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    client_id: client.client_id as string,
    redirect_uri: "http://localhost:4567/callback",
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    resource: "http://notes.test/api/mcp",
  });
  assert.throws(() => oauth.checkAuthorize(new URLSearchParams({ ...Object.fromEntries(query), redirect_uri: "http://localhost:9/other" }), "http://notes.test/api/mcp"));
  const code = oauth.issueCode(oauth.checkAuthorize(query, "http://notes.test/api/mcp"), true);

  const trade = (extra: Record<string, string>) => oauth.exchange(new URLSearchParams({ client_id: client.client_id as string, ...extra }));
  assert.throws(() => trade({ grant_type: "authorization_code", code, code_verifier: "w".repeat(50) }), /code_verifier/);
  assert.throws(() => trade({ grant_type: "authorization_code", code, code_verifier: verifier }), /used or expired/, "a failed attempt burns the code");

  const fresh = oauth.issueCode(oauth.checkAuthorize(query, "http://notes.test/api/mcp"), true);
  const tokens = trade({ grant_type: "authorization_code", code: fresh, code_verifier: verifier, redirect_uri: "http://localhost:4567/callback" });
  const tools = (await rpc("tools/list", {}, tokens.access_token)).body.result.tools.map((t: { name: string }) => t.name);
  assert.ok(tools.includes("read_note") && !tools.includes("create_note"), "allowed read only");

  const next = trade({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
  assert.equal((await rpc("tools/list", {}, tokens.access_token)).status, 401, "the old access token is replaced");
  assert.throws(() => trade({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }), /refresh token/, "refresh tokens rotate");
  assert.equal((await rpc("tools/list", {}, next.access_token)).status, 200);

  const grant = oauth.listGrants().find((g) => g.name === "Claude Code")!;
  assert.ok(grant.readOnly && grant.lastUsedAt);
  oauth.revokeGrant(grant.id);
  assert.equal((await rpc("tools/list", {}, next.access_token)).status, 401);
});

test("access: passwords are hashed, sessions follow the secret, sign-in off opens everything", async () => {
  const auth = await import("../src/lib/auth.ts");
  const current = access.getAccess()!;
  assert.ok(!JSON.stringify(current).includes("a-long-password"));
  assert.ok(auth.checkPassword(current, " Me ", "a-long-password"));
  assert.ok(!auth.checkPassword(current, "me", "wrong-password"));
  assert.throws(() => access.buildAccess(access.accessInput.parse({ mode: "password", username: "me", password: "short" }), null), /8 characters/);
  const { token } = auth.createSession(current);
  assert.ok(auth.isValidSession(token, current));
  // Same username, empty password: kept, and so are the sessions.
  const same = access.buildAccess(access.accessInput.parse({ mode: "password", username: "me" }), current);
  assert.equal(same.passwordHash, current.passwordHash);
  assert.ok(auth.isValidSession(token, same));
  const changed = access.buildAccess(access.accessInput.parse({ mode: "password", username: "me", password: "another-password" }), current);
  assert.ok(!auth.isValidSession(token, changed), "a new password signs everyone out");
  assert.ok(!auth.isValidSession(token, null), "not set up: nobody is signed in");

  access.saveAccess(access.buildAccess(access.accessInput.parse({ mode: "none" }), current));
  assert.ok(auth.isValidSession(undefined));
  const res = await POST(new Request("http://notes.test/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }));
  assert.equal(res.status, 200, "sign-in off: agents need no token");
});

test("setup code and reset file", async () => {
  const fs = await import("node:fs");
  const code = access.setupCode();
  assert.match(code, /^[0-9A-F]{5}-[0-9A-F]{5}$/);
  assert.ok(access.checkSetupCode(code.toLowerCase()) && !access.checkSetupCode("00000-00000"));
  fs.writeFileSync(path.join(dir, ".notes", "reset-access"), "");
  assert.equal(access.getAccess(), null, "the reset file clears sign-in");
  assert.ok(!fs.existsSync(path.join(dir, ".notes", "reset-access")));
});
