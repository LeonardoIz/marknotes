import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Stable releases only; numeric comparison prevents 0.10.0 sorting below 0.9.0.
export function parseVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Expected a stable MAJOR.MINOR.PATCH version, got ${version}`);
  }
  return version.split(".").map(BigInt);
}

export function highestVersion(tags) {
  const releases = tags.filter((tag) => {
    try { parseVersion(tag); return true; } catch { return false; }
  });
  return releases.sort((a, b) => {
    const left = parseVersion(a), right = parseVersion(b);
    for (let i = 0; i < 3; i++) {
      if (left[i] !== right[i]) return left[i] > right[i] ? -1 : 1;
    }
    return 0;
  })[0];
}

function tagsOf(version) {
  return version.metadata.container.tags;
}

// Old SHA tags came from the pre-release workflow. All other tags are retained.
function protectedTag(tag) {
  return !/^sha-[0-9a-f]+$/.test(tag);
}

export async function obsoleteVersions(versions, readManifest) {
  const keep = new Set();
  async function visit(digest) {
    if (keep.has(digest)) return;
    keep.add(digest);
    const manifest = await readManifest(digest);
    // Only manifests are package versions. Configs and layers are registry blobs.
    for (const child of manifest.manifests ?? []) await visit(child.digest);
  }
  for (const version of versions) {
    if (tagsOf(version).some(protectedTag)) await visit(version.name);
  }
  // Collect the entire graph before deleting anything. A failed read stops cleanup.
  return versions.filter((version) => !keep.has(version.name));
}

const command = (program, args) => execFileSync(program, args, { encoding: "utf8" });
const docker = (...args) => command("docker", ["buildx", "imagetools", ...args]);

async function waitForVersions(endpoint, predicate) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const versions = JSON.parse(command("gh", ["api", "--paginate", "--slurp", endpoint])).flat();
    if (predicate(versions)) return versions;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("GHCR package metadata has not caught up; skipping cleanup");
}

export async function publish({ image, version, digest, endpoint }, io) {
  parseVersion(version);
  let versions = await io.waitForVersions(endpoint, (items) =>
    items.some((item) => item.name === digest && tagsOf(item).includes(version)));
  const highest = highestVersion(versions.flatMap(tagsOf));
  const target = versions.find((item) => tagsOf(item).includes(highest));
  await io.promote(image, target.name);
  versions = await io.waitForVersions(endpoint, (items) =>
    items.some((item) => item.name === target.name && tagsOf(item).includes("latest")));
  const obsolete = await obsoleteVersions(versions, (name) => io.readManifest(image, name));
  for (const item of obsolete) await io.remove(endpoint, item);
  return { highest, deleted: obsolete.length };
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) throw new Error("GITHUB_REPOSITORY is required");
  if (process.argv[2] === "metadata") {
    const { version } = JSON.parse(readFileSync("package.json", "utf8"));
    parseVersion(version);
    if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== version) {
      throw new Error("Git tag must match the version in package.json");
    }
    appendFileSync(process.env.GITHUB_OUTPUT, `image=ghcr.io/${repository.toLowerCase()}\nversion=${version}\n`);
    return;
  }
  if (process.argv[2] !== "publish") throw new Error("Use metadata or publish");
  const ownerType = JSON.parse(command("gh", ["api", `repos/${repository}`])).owner.type;
  const [owner, name] = repository.split("/");
  const endpoint = `${ownerType === "Organization" ? "orgs" : "users"}/${owner}/packages/container/${encodeURIComponent(name.toLowerCase())}/versions`;
  const result = await publish({
    image: process.env.IMAGE, version: process.env.VERSION, digest: process.env.DIGEST, endpoint,
  }, {
    waitForVersions,
    promote: (image, digest) => docker("create", "--tag", `${image}:latest`, `${image}@${digest}`),
    readManifest: (image, digest) => JSON.parse(docker("inspect", "--raw", `${image}@${digest}`)),
    remove: (endpoint, item) => {
      console.log(`Deleting replaced image ${item.id} (${item.name})`);
      command("gh", ["api", "--method", "DELETE", `${endpoint}/${item.id}`]);
    },
  });
  console.log(`latest = ${result.highest}; removed ${result.deleted} obsolete manifests`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
