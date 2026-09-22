import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

const MIB = 1024 * 1024;
const MAX_UNREVIEWED_BYTES = 20 * MIB;

// Existing reviewed exceptions. New large model artifacts should be installed
// reproducibly at build time instead of extending this list.
const REVIEWED_LARGE_ASSETS = new Map([
  ["public/models/bdsl401-videomae/model.onnx", 96_764_338],
  ["public/models/bsl1064-pose2sign/model.onnx", 45_941_853],
]);

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const failures = [];
const reviewed = [];

for (const path of tracked) {
  let size;
  try {
    size = statSync(path).size;
  } catch {
    continue;
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

for (const item of reviewed) {
  console.log(`Reviewed legacy large asset: ${item.path} (${(item.size / MIB).toFixed(1)} MiB)`);
}

if (failures.length) {
  console.error("\nRepository asset policy failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Repository asset policy passed.");
