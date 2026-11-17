import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const rules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g],
  ["aws-access-id", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["service-secret", /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|sk_live_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g],
  ["credential-assignment", /(?:api[_-]?secret|client[_-]?secret|password|access[_-]?token|secret[_-]?key)\s*[=:]\s*["']([A-Za-z0-9_+\/=.-]{20,})["']/gi],
];
function git(args, { input, encoding = "utf8" } = {}) {
  const r = spawnSync("git", args, { input: input === undefined ? undefined : Buffer.from(input), encoding, maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`Git scan failed: ${args[0]}`);
  return r.stdout;
}
const findings = [];
function scan(text, location) {
  for (const [rule, expression] of rules) {
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) {
      // Literal examples and identifiers are not credentials.
      if (/example|placeholder|your[_-]|process\.env|changeme/i.test(match[0])) continue;
      findings.push({ rule, location, line: text.slice(0, match.index).split("\n").length });
    }
  }
}
const excludedAsset = /\.(?:bin|onnx|png|webp|jpg|jpeg|gz|zip|wasm|mp4)$/i;
const objects = git(["rev-list", "--objects", "--all"]).trim().split("\n");
let scanned = 0;
let skipped = 0;
const paths = new Map();
for (const row of objects) {
  const split = row.indexOf(" ");
  const path = split < 0 ? "" : row.slice(split + 1);
  if (!path || excludedAsset.test(path)) { skipped++; continue; }
  paths.set(row.slice(0, split), path);
}

function scanBatch(entries) {
  if (!entries.length) return;
  const content = git(["cat-file", "--batch"], { input: entries.map(entry => entry.sha).join("\n") + "\n", encoding: "buffer" });
  let offset = 0;
  for (const { sha, size } of entries) {
    const lineEnd = content.indexOf(10, offset);
    const end = lineEnd + size + 1;
    if (lineEnd < 0 || content.toString("ascii", offset, lineEnd) !== `${sha} blob ${size}` || content[end] !== 10) {
      throw new Error("Git blob payload did not agree with batch metadata");
    }
    scan(content.toString("utf8", lineEnd + 1, end), `${sha.slice(0, 12)}:${paths.get(sha)}`);
    offset = end + 1;
    scanned++;
  }
  if (offset !== content.length) throw new Error("Unexpected extra Git batch data");
}

if (paths.size) {
  const metadata = git(["cat-file", "--batch-check"], { input: [...paths.keys()].join("\n") + "\n" }).trim().split("\n");
  if (metadata.length !== paths.size) throw new Error("Git returned incomplete object metadata");
  let batch = [], bytes = 0;
  for (const row of metadata) {
    const [sha, type, length] = row.split(" ");
    const size = Number(length);
    if (!paths.has(sha) || !Number.isSafeInteger(size) || size < 0) throw new Error("Invalid Git object metadata");
    if (type !== "blob" || size > 5 * 1024 * 1024) { skipped++; continue; }
    if (bytes + size > 16 * 1024 * 1024) { scanBatch(batch); batch = []; bytes = 0; }
    batch.push({ sha, size });
    bytes += size;
  }
  scanBatch(batch);
}
for (const path of git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0")) {
  if (!path || excludedAsset.test(path)) continue;
  try { scan(readFileSync(path, "utf8"), `working-tree:${path}`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
for (const path of readdirSync(".").filter(name => /^\.env(?:\.|$)/.test(name))) scan(readFileSync(path, "utf8"), `local:${path}`);
console.log(JSON.stringify({ scope: "All fetched Git refs and working tree; text blobs up to 5 MiB; known credential patterns. Values are never printed.", commits: Number(git(["rev-list", "--all", "--count"]).trim()), scannedHistoricalBlobs: scanned, skippedObjects: skipped, findings }, null, 2));
if (findings.length) process.exitCode = 1;
