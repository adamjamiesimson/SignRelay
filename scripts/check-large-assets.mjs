import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

const MIB = 1024 * 1024;
const MAX_UNREVIEWED_BYTES = 20 * MIB;
const MAX_UNREVIEWED_MODEL_DIR_BYTES = 25 * MIB;

// Existing reviewed exceptions. New large model artifacts should be installed
// reproducibly at build time instead of extending these lists.
const REVIEWED_LARGE_ASSETS = new Map([
  ["public/models/bdsl401-videomae/model.onnx", 96_764_338],
  ["public/models/bsl1064-pose2sign/model.onnx", 45_941_853],
]);

const REVIEWED_LARGE_MODEL_DIRS = new Map([
  ["public/models/bdsl401-videomae", 96_778_887],
  ["public/models/bsl1064-pose2sign", 45_954_876],
]);

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const failures = [];
const reviewed = [];
const modelDirSizes = new Map();

for (const path of tracked) {
  let size;
  try {
    size = statSync(path).size;
  } catch {
    continue;
  }

  if (path.startsWith("public/models/")) {
    const parts = path.split("/");
    if (parts.length >= 3) {
      const modelDir = parts.slice(0, 3).join("/");
      modelDirSizes.set(modelDir, (modelDirSizes.get(modelDir) ?? 0) + size);
    }
  }

  const reviewedLimit = REVIEWED_LARGE_ASSETS.get(path);
  if (reviewedLimit !== undefined) {
    reviewed.push({ path, size });
    if (size > reviewedLimit) {
      failures.push(
        `${path} grew from the reviewed ceiling of ${reviewedLimit} bytes to ${size} bytes. Move new model weight to a reproducible installer/build artifact instead.`,
      );
    }
    continue;
  }

  if (size > MAX_UNREVIEWED_BYTES) {
    failures.push(
      `${path} is ${(size / MIB).toFixed(1)} MiB. New tracked files over 20 MiB are blocked; use a checksum-verified installer, release artifact, or external model host.`,
    );
  }
}

for (const [modelDir, size] of modelDirSizes) {
  const reviewedLimit = REVIEWED_LARGE_MODEL_DIRS.get(modelDir);
  if (reviewedLimit !== undefined) {
    if (size > reviewedLimit) {
      failures.push(
        `${modelDir} grew from the reviewed directory ceiling of ${(reviewedLimit / MIB).toFixed(1)} MiB to ${(size / MIB).toFixed(1)} MiB.`,
      );
    }
    continue;
  }

  if (size > MAX_UNREVIEWED_MODEL_DIR_BYTES) {
    failures.push(
      `${modelDir} totals ${(size / MIB).toFixed(1)} MiB. New model directories over 25 MiB are blocked even when split into smaller shards.`,
    );
  }
}

for (const item of reviewed) {
  console.log(`Reviewed legacy large asset: ${item.path} (${(item.size / MIB).toFixed(1)} MiB)`);
}

if (failures.length) {
  console.error("\nRepository asset policy failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Repository asset policy passed.");
