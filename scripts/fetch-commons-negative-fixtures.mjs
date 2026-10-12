#!/usr/bin/env node
/**
 * Fetch two small, individually attributed Wikimedia Commons gesture clips.
 * They are negative *intent* controls, not proof that similar hand movements
 * cannot overlap with legitimate ASL signs. Video remains local and gitignored.
 */
import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const manifest = resolve(process.argv[2] ?? "evaluation/popsign-test.local.jsonl");
const videoDir = resolve(process.argv[3] ?? "evaluation/videos/commons-negatives");
const choices = [
  {
    id: "commons-nonsign-wave", file: "HandWaveExample.webm",
    license: "CC BY-SA 4.0", creator: "NMu11er",
    description: "Non-sign-intent group waving; possible HELLO visual overlap",
  },
  {
    id: "commons-nonsign-fish", file: "Fish on hand.webm",
    license: "CC BY-SA 4.0", creator: "KEmel49",
    description: "Person holding a fish; non-sign-intent hand activity",
  },
];

function sourceUrl(file) {
  const canonical = file.replaceAll(" ", "_");
  return "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(canonical);
}
function downloadUrls(file) {
  const canonical = file.replaceAll(" ", "_");
  const md5 = createHash("md5").update(canonical).digest("hex");
  return [
    "https://commons.wikimedia.org/wiki/Special:Redirect/file/" + encodeURIComponent(canonical),
    "https://upload.wikimedia.org/wikipedia/commons/" + md5[0] + "/" + md5.slice(0, 2) + "/" + encodeURIComponent(canonical),
  ];
}
async function obtainVideo(file) {
  const errors = [];
  for (const url of downloadUrls(file)) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(25_000),
        redirect: "follow",
        headers: {
          "User-Agent": "SignRelayResearchFixture/1.0 (noncommercial accessibility research; https://github.com/adamjamiesimson/SignRelay)",
          "Accept": "video/webm,application/octet-stream,*/*",
        },
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const declaredSize = Number(response.headers.get("content-length") ?? "0");
      if (declaredSize > 10_000_000) throw new Error("file exceeds 10 MB cap");
      const bytes = new Uint8Array(await response.arrayBuffer());
      // WebM EBML header, reject HTML/blocked requests even when HTTP 200.
      if (bytes.length < 30_000 || bytes.length > 10_000_000 ||
          bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) {
        throw new Error("response is not a suitable WebM file");
      }
      return { bytes, source: url };
    } catch (error) {
      errors.push(url + ": " + (error instanceof Error ? error.message : String(error)));
    }
  }
  throw new Error("Unable to fetch " + file + ": " + errors.join("; "));
}

await mkdir(videoDir, { recursive: true });
const records = [];
for (const choice of choices) {
  const { bytes } = await obtainVideo(choice.file);
  const filePath = join(videoDir, choice.id + ".webm");
  await writeFile(filePath, bytes);
  records.push({
    id: choice.id,
    language: "asl",
    trial_type: "no_sign",
    expected_gloss: null,
    video: relative(resolve(manifest, ".."), filePath).replaceAll("\\", "/"),
    condition: "real-world-nonsign-intent-gesture",
    device: "public-source-video",
    source: sourceUrl(choice.file),
    license: choice.license,
    creator: choice.creator,
    notes: choice.description + "; sha256=" + createHash("sha256").update(bytes).digest("hex"),
  });
  console.log("READY " + choice.id + " (" + bytes.length + " bytes); " + choice.license);
}
await appendFile(manifest, records.map(record => JSON.stringify(record)).join("\n") + "\n");
console.log("Added " + records.length + " licensed non-sign-intent video trials to " + manifest);
