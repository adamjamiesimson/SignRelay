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
function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
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
const objects = git(["rev-list", "--objects", "--all"]).trim().split("\n");
let scanned = 0;
let skipped = 0;
for (const row of objects) {
  const [sha, ...parts] = row.split(" ");
  const path = parts.join(" ");
  if (!path || /\.(?:bin|onnx|png|webp|jpg|jpeg|gz|zip|wasm|mp4)$/i.test(path)) { skipped++; continue; }
  const size = Number(git(["cat-file", "-s", sha]).trim());
  if (size > 5 * 1024 * 1024 || git(["cat-file", "-t", sha]).trim() !== "blob") { skipped++; continue; }
  scan(git(["cat-file", "blob", sha]), `${sha.slice(0, 12)}:${path}`);
  scanned++;
}
for (const path of git(["ls-files", "--cached", "--others", "--exclude-standard"]).trim().split("\n")) {
  if (!path || /\.(?:bin|onnx|png|webp|jpg|jpeg|gz|zip|wasm|mp4)$/i.test(path)) continue;
  try { scan(readFileSync(path, "utf8"), `working-tree:${path}`); } catch { /* Deleted tracked files. */ }
}
for (const path of readdirSync(".").filter(name => /^\.env(?:\.|$)/.test(name))) scan(readFileSync(path, "utf8"), `local:${path}`);
console.log(JSON.stringify({ scope: "All fetched Git refs and working tree; text blobs up to 5 MiB; known credential patterns. Values are never printed.", commits: Number(git(["rev-list", "--all", "--count"]).trim()), scannedHistoricalBlobs: scanned, skippedObjects: skipped, findings }, null, 2));
if (findings.length) process.exitCode = 1;
