// Which objects does the page retain across repeated fingerspelling captures?
// Real rehearsal export, synthetic fake camera (no person, no landmarks).
// Takes forced-GC heap snapshots after warm-up and after each batch of
// Start/Finish cycles, then diffs live object counts and self sizes by
// constructor. Growth that keeps rising with cycles points at retention;
// a one-off step is allocator/JIT warm-up.
//
// usage: node scripts/diagnostics/heap-growth-browser.mjs <chrome> <cyclesPerBatch> <batches> <out.json> [control]
// control=1 performs the same CDP polling and waiting but never captures: it
// measures what the harness's own evaluate() calls add to the page heap.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { openRehearsal, until, pause } from "../../tests/rehearsal-harness.mjs";
import { writeIdentityY4m } from "./frame-identity.mjs";

const [chrome, cyclesArg = "20", batchesArg = "3", out = "work/heap-growth.json"] = process.argv.slice(2);
const cyclesPerBatch = Number(cyclesArg), batches = Number(batchesArg), control = process.argv[6] === "1";
const video = resolve(tmpdir(), "signrelay-heap-30.y4m");
writeIdentityY4m(video, { fps: 30, frames: 900 });
const h = await openRehearsal(chrome, { extraArgs: [`--use-file-for-fake-video-capture=${video}`] });

async function snapshot() {
  await h.browser.send("HeapProfiler.collectGarbage");
  await h.browser.send("HeapProfiler.collectGarbage");
  let chunks = [];
  const off = h.browser.onEvent(message => { if (message.method === "HeapProfiler.addHeapSnapshotChunk") chunks.push(message.params.chunk); });
  await h.browser.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, captureNumericValue: false });
  off?.();
  const snap = JSON.parse(chunks.join("")); chunks = [];
  const fields = snap.snapshot.meta.node_fields, types = snap.snapshot.meta.node_types[0], width = fields.length;
  const f = name => fields.indexOf(name);
  const [iType, iName, iSize] = [f("type"), f("name"), f("self_size")];
  const byName = new Map();
  let total = 0;
  for (let i = 0; i < snap.nodes.length; i += width) {
    const type = types[snap.nodes[i + iType]];
    const name = type === "object" || type === "closure" || type === "native" ? snap.strings[snap.nodes[i + iName]] : `(${type})`;
    const size = snap.nodes[i + iSize]; total += size;
    const entry = byName.get(name) ?? { count: 0, size: 0 }; entry.count++; entry.size += size; byName.set(name, entry);
  }
  return { total, byName };
}
const capture = async () => {
  if (control) {
    await until(() => h.evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Capture name' && !b.disabled)`), "Capture control disabled");
    await h.has("Capture name"); await pause(1200); await h.has("Finish capture");
    for (let i = 0; i < 6; i++) { await h.evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Capture name' && !b.disabled)`); await pause(100); }
    return;
  }
  await until(() => h.evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Capture name' && !b.disabled)`), "Capture control disabled");
  await h.click("Capture name"); await pause(1200); await h.click("Finish capture");
  await until(() => h.evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Capture name' && !b.disabled)`), "Capture did not return to ready");
};
try {
  await h.browser.send("HeapProfiler.enable");
  await h.open("/?perf"); await h.start(); await h.click("Fingerspelling");
  await until(() => h.evaluate(`document.querySelector('.status-badge')?.textContent === 'Active'`), "Camera inactive");
  for (let i = 0; i < 5; i++) await capture(); // warm-up
  const snaps = [await snapshot()];
  for (let b = 0; b < batches; b++) { for (let i = 0; i < cyclesPerBatch; i++) await capture(); snaps.push(await snapshot()); }
  const names = new Set(snaps.flatMap(s => [...s.byName.keys()]));
  const growth = [...names].map(name => {
    const series = snaps.map(s => s.byName.get(name) ?? { count: 0, size: 0 });
    return { name, counts: series.map(s => s.count), sizes: series.map(s => s.size),
      monotonic: series.every((s, i) => i === 0 || s.count >= series[i - 1].count) && series.at(-1).count > series[0].count };
  }).filter(g => g.sizes.at(-1) - g.sizes[0] > 2000 || (g.monotonic && g.counts.at(-1) - g.counts[0] >= cyclesPerBatch))
    .sort((a, b) => (b.sizes.at(-1) - b.sizes[0]) - (a.sizes.at(-1) - a.sizes[0])).slice(0, 25);
  const result = { control, kind: "headless Chromium main-thread heap snapshots; synthetic fake camera; not worker/WASM/GPU memory", cyclesPerBatch, batches,
    totalBytes: snaps.map(s => s.total), growth };
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(result, null, 1));
  console.log("HEAP-GROWTH", JSON.stringify({ totalBytes: result.totalBytes, top: growth.slice(0, 12).map(g => [g.name.slice(0, 60), g.counts, g.sizes.at(-1) - g.sizes[0]]) }));
} finally { await h.close(); }
