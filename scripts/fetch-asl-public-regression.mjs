#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const sourcePath = resolve(process.argv[2] ?? "evaluation/asl-public-regression-sources.json");
const outputDir = resolve(process.argv[3] ?? "evaluation/videos/asl-public-regression");
const manifestPath = resolve(process.argv[4] ?? "evaluation/asl-public-regression.local.jsonl");

const config = JSON.parse(await readFile(sourcePath, "utf8"));
await mkdir(outputDir, { recursive: true });

async function download(url, path) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "SignRelay research regression evaluator/1.0" },
  });
  if (!response.ok) throw new Error(`Download failed ${response.status} ${response.statusText}: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 10_000) throw new Error(`Downloaded fixture is unexpectedly small (${bytes.byteLength} bytes): ${url}`);
  await writeFile(path, bytes);
  return bytes.byteLength;
}

async function downloadWithYtDlp(url, path) {
  await run("yt-dlp", [
    "--no-playlist",
    "--quiet",
    "--no-warnings",
    "--merge-output-format", "mp4",
    "-f", "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
    "-o", path,
    url,
  ]);
  const bytes = (await readFile(path)).byteLength;
  if (bytes < 10_000) throw new Error(`yt-dlp fixture is unexpectedly small (${bytes} bytes): ${url}`);
  return bytes;
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", rejectPromise);
    child.on("exit", code => code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} exited with code ${code}`)));
  });
}

const rows = [];
const unavailable = [];

for (const fixture of config.sign_fixtures) {
  const extension = extname(new URL(fixture.url).pathname) || ".mp4";
  const file = join(outputDir, `${fixture.id}${extension}`);
  try {
    const bytes = fixture.download_method === "yt-dlp"
      ? await downloadWithYtDlp(fixture.url, file)
      : await download(fixture.url, file);
    rows.push({
      id: fixture.id,
      language: "asl",
      trial_type: "sign",
      expected_gloss: fixture.gloss,
      video: file,
      condition: "public-source-original",
      signer_id: fixture.signer_id,
      split: fixture.wlasl_split,
      source: `WLASL v0.3 test / ${fixture.source} / video ${fixture.wlasl_video_id}`,
      notes: [fixture.note, `${bytes} bytes`].filter(Boolean).join("; "),
    });
    console.log(`READY ${fixture.id} (${bytes} bytes)`);
  } catch (error) {
    unavailable.push({ id: fixture.id, url: fixture.url, error: error instanceof Error ? error.message : String(error) });
    console.warn(`SKIP  ${fixture.id}: ${unavailable.at(-1).error}`);
    await rm(file, { force: true });
  }
}

for (const fixture of config.no_sign_fixtures) {
  const rawExtension = extname(new URL(fixture.url).pathname) || ".webm";
  const raw = join(outputDir, `${fixture.id}.source${rawExtension}`);
  const trimmed = join(outputDir, `${fixture.id}.webm`);
  try {
    const bytes = await download(fixture.url, raw);
    if (fixture.trim_seconds) {
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-t", String(fixture.trim_seconds),
        "-an", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "5", trimmed]);
      await rm(raw, { force: true });
    } else {
      await writeFile(trimmed, await readFile(raw));
      await rm(raw, { force: true });
    }
    rows.push({
      id: fixture.id,
      language: "asl",
      trial_type: "no_sign",
      expected_gloss: null,
      video: trimmed,
      condition: "public-negative-original",
      signer_id: null,
      split: "external-negative",
      source: `${fixture.source} / ${fixture.license}`,
      notes: [fixture.note, `source download ${bytes} bytes`].filter(Boolean).join("; "),
    });
    console.log(`READY ${fixture.id}`);
  } catch (error) {
    unavailable.push({ id: fixture.id, url: fixture.url, error: error instanceof Error ? error.message : String(error) });
    console.warn(`SKIP  ${fixture.id}: ${unavailable.at(-1).error}`);
    await rm(raw, { force: true });
    await rm(trimmed, { force: true });
  }
}

if (rows.length < 4) {
  throw new Error(`Only ${rows.length} fixtures were available; refusing to run a misleading benchmark`);
}

const manifestDir = resolve(manifestPath, "..");
const relativeRows = rows.map(row => ({
  ...row,
  video: row.video.replace(manifestDir + "/", ""),
}));
await writeFile(manifestPath, relativeRows.map(row => JSON.stringify(row)).join("\n") + "\n", "utf8");
await writeFile(resolve(outputDir, "availability.json"), JSON.stringify({
  generated_at: new Date().toISOString(),
  ready: rows.map(row => row.id),
  unavailable,
}, null, 2), "utf8");

console.log(`\nManifest: ${manifestPath}`);
console.log(`Ready: ${rows.length}; unavailable: ${unavailable.length}`);
