import assert from "node:assert/strict";
import test from "node:test";
import { highestVersion, obsoleteVersions, parseVersion, publish } from "./release.mjs";

const image = (id, tags = []) => ({ id, name: `sha256:${id}`, metadata: { container: { tags } } });
const index = (...ids) => ({ manifests: ids.map((id) => ({ digest: `sha256:${id}` })) });

test("version ordering uses numbers and excludes non-release tags", () => {
  assert.equal(highestVersion(["latest", "sha-abc123", "0.9.9", "0.10.0", "0.1.0", "0.11.0-rc.1"]), "0.10.0");
  assert.equal(highestVersion(["1.99.99", "2.0.0", "1.100.0"]), "2.0.0");
  assert.equal(highestVersion(["0.1.10", "0.1.9"]), "0.1.10");
  for (const invalid of ["v0.1.0", "01.1.0", "0.1", "0.1.0-rc.1", "0.1.0+build", "latest"]) {
    assert.throws(() => parseVersion(invalid));
  }
});

test("cleanup preserves multiarch images, attestations, shared children and other tagged releases", async () => {
  const versions = [
    image("current", ["0.2.0", "latest"]), image("amd64"), image("arm64"), image("attestation"),
    image("older", ["0.1.0"]), image("old-arm64"),
    image("replaced"), image("orphan-child"), image("legacy", ["sha-730d1c3"]),
    image("custom", ["keep-me"]), image("custom-child"),
  ];
  const manifests = {
    "sha256:current": index("amd64", "arm64", "attestation"),
    "sha256:older": index("amd64", "old-arm64"),
    "sha256:custom": index("custom-child"),
  };
  const obsolete = await obsoleteVersions(versions, async (digest) => manifests[digest] ?? {});
  assert.deepEqual(obsolete.map((v) => v.id), ["replaced", "orphan-child", "legacy"]);
});

test("rebuilding an older version keeps latest on the highest version and removes the replaced graph", async () => {
  const versions = [
    image("highest", ["0.10.0", "latest"]), image("high-child"),
    image("rebuilt", ["0.9.0"]), image("new-child"), image("replaced"), image("old-child"),
  ];
  const removed = [], promoted = [];
  const result = await publish({ image: "ghcr.io/example/app", version: "0.9.0", digest: "sha256:rebuilt", endpoint: "versions" }, {
    waitForVersions: async (_, predicate) => {
      assert.ok(predicate(versions));
      return versions;
    },
    promote: async (...args) => promoted.push(args),
    readManifest: async (_, digest) => ({
      "sha256:highest": index("high-child"), "sha256:rebuilt": index("new-child"),
    })[digest] ?? {},
    remove: async (_, item) => removed.push(item.id),
  });
  assert.deepEqual(promoted, [["ghcr.io/example/app", "sha256:highest"]]);
  assert.deepEqual(removed, ["replaced", "old-child"]);
  assert.deepEqual(result, { highest: "0.10.0", deleted: 2 });
});

test("a newer release moves latest before any cleanup", async () => {
  const versions = [image("old", ["0.1.0", "latest"]), image("new", ["0.2.0"])];
  const events = [];
  await publish({ image: "example", version: "0.2.0", digest: "sha256:new", endpoint: "versions" }, {
    waitForVersions: async (_, predicate) => {
      assert.ok(predicate(versions));
      return versions;
    },
    promote: async (_, digest) => {
      events.push("promote");
      assert.equal(digest, "sha256:new");
      versions[0].metadata.container.tags = ["0.1.0"];
      versions[1].metadata.container.tags.push("latest");
    },
    readManifest: async () => { events.push("inspect"); return {}; },
    remove: async () => { throw new Error("Published releases must be kept"); },
  });
  assert.equal(events[0], "promote");
});

test("repeating an identical publication does not delete the current image", async () => {
  const versions = [image("same", ["0.1.0", "latest"])];
  const result = await publish({ image: "example", version: "0.1.0", digest: "sha256:same", endpoint: "versions" }, {
    waitForVersions: async (_, predicate) => { assert.ok(predicate(versions)); return versions; },
    promote: async () => {},
    readManifest: async () => ({}),
    remove: async () => assert.fail("Must not delete the current image"),
  });
  assert.equal(result.deleted, 0);
});

test("a failed manifest inspection prevents all deletion", async () => {
  let removed = false;
  const versions = [image("current", ["0.1.0", "latest"]), image("orphan")];
  await assert.rejects(publish({ image: "example", version: "0.1.0", digest: "sha256:current", endpoint: "versions" }, {
    waitForVersions: async (_, predicate) => { assert.ok(predicate(versions)); return versions; },
    promote: async () => {},
    readManifest: async () => { throw new Error("Registry unavailable"); },
    remove: async () => { removed = true; },
  }), /Registry unavailable/);
  assert.equal(removed, false);
});
