// Which hand does the one-hand fingerspelling tracker follow when a second,
// unrelated hand is visible, and does it ever switch mid-capture?
// Controlled composites of REAL licensed frames (tracking-determinism-prepare.py;
// runner-local): the signer in one half of a double-width canvas and a
// different catalog clip (another signer) in the other half. No landmark is
// synthesised; the tracker sees real hands in a constructed scene.
//
//   solo         signer | empty half             (reference for this canvas)
//   distractor   signer | other signer, throughout
//   enters       signer | other signer from the annotation midpoint on
//   swapped      other signer | signer           (selection-side preference)
//
// Per configuration: frames tracking the signer vs the distractor, ownership
// switches of the hand capture would select (dominant label, first match),
// signer handedness-label flips, the wrist jump at each switch versus the largest genuine
// frame-to-frame wrist motion, and the decoded outcome through production
// capture + CTC. Counts and distances only; no frames, landmarks or text.
//
// usage: node scripts/diagnostics/run-two-hand.mjs <chrome> <out.json> [engine:numHands,...]
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { startChrome } from "./chrome-session.mjs";
import { createSession, replayData } from "./replay-fingerspelling-trace";
import type { Sample, Step } from "./tracking-determinism-rgb";
import type { HandObservation } from "../../lib/vision-types";

type Layout = "solo" | "distractor" | "enters" | "swapped";
const LAYOUTS: Layout[] = ["solo", "distractor", "enters", "swapped"];
const levenshtein = (a: string, b: string) => {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { let p = row[0]; row[0] = i; for (let j = 1; j <= b.length; j++) { const v = Math.min(row[j] + 1, row[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = row[j]; row[j] = v; } }
  return row[b.length];
};

async function main() {
  const [chrome, out = "work/two-hand-rgb.json", configArg = "landmarker:1,gesture:2"] = process.argv.slice(2);
  const configs = configArg.split(",").map(c => { const [engine, hands] = c.split(":"); return { name: c, engine, numHands: Number(hands) }; });
  const root = resolve("work/determinism"), exportRoot = resolve("out");
  const samples: Sample[] = JSON.parse(readFileSync(join(root, "samples.json"), "utf8"));
  const types: Record<string, string> = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".png": "image/png", ".html": "text/html" };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>two hands</title>"); return; }
    const base = url.pathname.startsWith("/frames/") ? root : exportRoot;
    const file = normalize(join(base, decodeURIComponent(url.pathname)));
    if (!file.startsWith(base) || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream"); res.end(readFileSync(file));
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const browser = await startChrome(chrome, { proxy: undefined });
  const session = await createSession();
  try {
    await browser.send("Page.navigate", { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` });
    await new Promise(r => setTimeout(r, 1000));
    // Each step names the signer frame and (optionally) the distractor frame.
    await browser.evaluate(`window.track = async (steps, options) => {
      const worker = new Worker("/workers/fingerspelling-vision.worker.js");
      const reply = (message, transfer, kind) => new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => { if (data.type === "error") reject(new Error(data.message)); else if (data.type === kind) resolve(data); };
        worker.onerror = e => reject(new Error(e.message)); worker.postMessage(message, transfer);
      });
      const load = async url => url ? createImageBitmap(await (await fetch(url)).blob()) : null;
      try {
        const ready = await reply({ type: "init", ...options }, [], "ready");
        if (ready.engine !== options.engine || ready.numHands !== options.numHands) throw new Error("configuration not applied");
        const out = [];
        for (const { left, right, ts } of steps) {
          const [a, b] = [await load(left), await load(right)];
          const ref = a ?? b, half = Math.min(640, Math.round(640 * ref.width / ref.height / 2) * 2) / 2;
          const h = Math.round(half * ref.height / ref.width), w = half * 2;
          const canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext("2d");
          ctx.fillStyle = "#20242c"; ctx.fillRect(0, 0, w, h);
          if (a) { ctx.drawImage(a, 0, 0, half, h); a.close(); }
          if (b) { ctx.drawImage(b, half, 0, half, h); b.close(); }
          const bitmap = canvas.transferToImageBitmap();
          const { frame } = await reply({ type: "frame", bitmap, timestamp: ts }, [bitmap], "result");
          out.push({ hands: frame.hands, aspect: w / h });
        }
        return out;
      } finally { worker.terminate(); }
    }; true`);
    const cases: Record<string, unknown>[] = [];
    for (const [k, sample] of samples.entries()) {
      const other = samples[(k + 1) % samples.length];
      const mid = (sample.annotationStartMs + sample.annotationEndMs) / 2;
      const steps: Step[] = []; let last = -Infinity;
      sample.frames.forEach((f, i) => { const slot = Math.floor(f.ms * 15 / 1000 + 1e-6); if (slot > last) { last = slot; steps.push({ i, ts: f.ms + 1000 }); } });
      // The distractor plays its own clip from its start, looping if shorter.
      const distractor = (n: number) => other.frames[n % other.frames.length].png;
      const signerSide = (layout: Layout) => layout === "swapped" ? "right" : "left";
      const row: Record<string, unknown> = { case: sample.index, role: sample.role, configs: {} };
      for (const config of configs) {
        const layouts: Record<string, unknown> = {};
        for (const layout of LAYOUTS) {
          const plan = steps.map((s, n) => {
            const own = sample.frames[s.i].png, extra = layout === "solo" || (layout === "enters" && sample.frames[s.i].ms < mid) ? null : distractor(n);
            return layout === "swapped" ? { left: extra, right: own, ts: s.ts } : { left: own, right: extra, ts: s.ts };
          });
          const tracked = await browser.evaluate(`track(${JSON.stringify(plan)}, ${JSON.stringify({ engine: config.engine, numHands: config.numHands })})`) as { hands: HandObservation[]; aspect: number }[];
          const side = signerSide(layout);
          const owner = (hand: HandObservation) => (hand.landmarks[0].x < 0.5 ? "left" : "right") === side ? "signer" : "distractor";
          let signerFrames = 0, distractorFrames = 0, both = 0, switches = 0, selectedDistractor = 0, signerLabelFlips = 0, previousOwner: string | null = null, previousWrist: { x: number; y: number } | null = null;
          let maxGenuineJump = 0, minSwitchJump = Infinity, previousSignerLabel: string | null = null;
          const inside = steps.map((s, n) => ({ s, n })).filter(({ s }) => sample.frames[s.i].ms >= sample.annotationStartMs && sample.frames[s.i].ms <= sample.annotationEndMs);
          // Mirror FingerspellingCapture.tensor(): the side label with more
          // frames wins, and each frame uses the FIRST hand carrying that label.
          const count = (label: string) => inside.filter(({ n }) => tracked[n].hands.some(h => h.handedness === label && h.landmarks.length === 21)).length;
          const dominant = count("Left") >= count("Right") ? "Left" : "Right";
          for (const { n } of inside) {
            const hands = tracked[n].hands;
            const owners = hands.map(owner);
            if (owners.includes("signer")) signerFrames++;
            if (owners.includes("distractor")) distractorFrames++;
            if (owners.length > 1) both++;
            const signerHand = hands.find(h => owner(h) === "signer");
            if (signerHand) { if (previousSignerLabel && signerHand.handedness !== previousSignerLabel) signerLabelFlips++; previousSignerLabel = signerHand.handedness; }
            const first = hands.find(h => h.handedness === dominant && h.landmarks.length === 21);
            if (first && owner(first) === "distractor") selectedDistractor++;
            if (first) {
              const who = owner(first), wrist = { x: first.landmarks[0].x * tracked[n].aspect, y: first.landmarks[0].y };
              if (previousOwner && previousWrist) {
                const jump = Math.hypot(wrist.x - previousWrist.x, wrist.y - previousWrist.y);
                if (who !== previousOwner) { switches++; minSwitchJump = Math.min(minSwitchJump, jump); } else maxGenuineJump = Math.max(maxGenuineJump, jump);
              }
              previousOwner = who; previousWrist = wrist;
            }
          }
          const trace = { schema: "signrelay-fingerspelling-trace-v1", aspect: tracked[0]?.aspect ?? 2, featureVersion: "v3",
            samples: inside.map(({ s, n }) => ({ time: s.ts, capturedAt: s.ts, hands: tracked[n].hands })) };
          const result = await replayData(session, trace, `case-${sample.index}-${config.name}-${layout}`, true);
          const text = (result.text ?? "").trim();
          layouts[layout] = { frames: inside.length, signerFrames, distractorFrames, framesWithBoth: both, selectedDistractorFrames: selectedDistractor, signerLabelFlips, selectedHandSwitches: switches,
            maxGenuineWristJump: Math.round(maxGenuineJump * 1000) / 1000, minSwitchWristJump: Number.isFinite(minSwitchJump) ? Math.round(minSwitchJump * 1000) / 1000 : null,
            status: result.captureError ? "quality-rejected" : result.status, captureError: result.captureError ? String(result.captureError).replace(/^Error: /, "") : undefined,
            exact: text === sample.reference, edits: levenshtein(text, sample.reference), referenceCharacters: sample.reference.length, output: result.fingerprints.output };
        }
        (row.configs as Record<string, unknown>)[config.name] = layouts;
      }
      cases.push(row);
      console.log("TWO-HAND-CASE", JSON.stringify({ case: sample.index, configs: Object.fromEntries(Object.entries(row.configs as Record<string, Record<string, { signerFrames: number; distractorFrames: number; selectedHandSwitches: number; frames: number; status: string }>>).map(([n, l]) => [n, Object.fromEntries(Object.entries(l).map(([k, v]) => [k, [v.signerFrames, v.distractorFrames, v.selectedHandSwitches, v.frames, v.status]]))])) }));
    }
    type Cell = { frames: number; signerFrames: number; distractorFrames: number; selectedDistractorFrames: number; signerLabelFlips: number; selectedHandSwitches: number; maxGenuineWristJump: number; minSwitchWristJump: number | null; status: string; exact: boolean; edits: number; referenceCharacters: number; output?: string };
    const summary = { kind: "Composites of real licensed FSboard frames (signer plus a different catalog signer); production tracking worker in lockstep; exposed regression clips; behaviour, not accuracy",
      clips: cases.length, configs: Object.fromEntries(configs.map(c => [c.name, Object.fromEntries(LAYOUTS.map(layout => {
        const cells = cases.map(r => (r.configs as Record<string, Record<string, Cell>>)[c.name][layout]);
        const solo = cases.map(r => (r.configs as Record<string, Record<string, Cell>>)[c.name].solo);
        return [layout, { frames: cells.reduce((n, x) => n + x.frames, 0), signerFrames: cells.reduce((n, x) => n + x.signerFrames, 0), distractorFrames: cells.reduce((n, x) => n + x.distractorFrames, 0),
          selectedDistractorFrames: cells.reduce((n, x) => n + x.selectedDistractorFrames, 0), signerLabelFlips: cells.reduce((n, x) => n + x.signerLabelFlips, 0),
          clipsWithSwitch: cells.filter(x => x.selectedHandSwitches > 0).length, switches: cells.reduce((n, x) => n + x.selectedHandSwitches, 0),
          maxGenuineWristJump: Math.max(0, ...cells.map(x => x.maxGenuineWristJump)), minSwitchWristJump: Math.min(Infinity, ...cells.map(x => x.minSwitchWristJump ?? Infinity)),
          sameOutputAsSolo: cells.filter((x, j) => x.output !== undefined && x.output === solo[j].output).length,
          exact: cells.filter(x => x.exact).length, edits: cells.reduce((n, x) => n + x.edits, 0), characters: cells.reduce((n, x) => n + x.referenceCharacters, 0),
          qualityRejected: cells.filter(x => x.status === "quality-rejected").length }];
      }))])) };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ summary, cases }, null, 1));
    console.log("TWO-HAND-SUMMARY", JSON.stringify(summary));
  } finally { await session.release(); await browser.close(); server.close(); }
}
if (process.argv[1]?.includes("two-hand-rgb")) await main();
