// Is the production CPU hand tracker deterministic for identical pixels and
// timestamps, and does dropping ONE frame change later observations?
// Rendered synthetic hands only (skin-toned geometry from the kinematic
// fixtures): no person, recording or real landmarks. Uses the real rehearsal
// export's fingerspelling tracking worker and pinned model.
//
// usage: node scripts/diagnostics/tracking-determinism-browser.mjs <chrome> <out.json>
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { build } from "esbuild";
import { openRehearsal } from "../../tests/rehearsal-harness.mjs";

const [chrome, out = "work/tracking-determinism.json"] = process.argv.slice(2);
const fixture = await build({ stdin: { contents: `export { makeSign } from "./tests/fixtures/asl-motion.ts"; export { fingerprintObservations } from "./lib/pipeline-fingerprint.ts";`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, format: "iife", globalName: "__fixtures", platform: "browser", write: false, logLevel: "error" });
const h = await openRehearsal(chrome);
try {
  await h.open("/");
  await h.evaluate(fixture.outputFiles[0].text + "; window.__fixtures = __fixtures; true");
  if (process.env.TRACKING_STYLE) await h.evaluate(`window.__style = ${process.env.TRACKING_STYLE}; true`);
  const result = await h.evaluate(`(async () => {
    const { makeSign, fingerprintObservations } = window.__fixtures;
    // 2 s of a moving synthetic hand at 15 Hz: palm polygon + thick fingers.
    const frames = [...makeSign("HELLO", { count: 15, duration: 1000 }), ...makeSign("THANK YOU", { count: 15, duration: 1000 })]
      .map((frame, i) => ({ ...frame, timestamp: 1000 + i * 1000 / 15 }));
    const bones = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
    const style = window.__style ?? { scale: 3, background: "#e5e7eb", width: 0.11, arm: true };
    const render = frame => {
      const canvas = new OffscreenCanvas(640, 480), ctx = canvas.getContext("2d");
      ctx.fillStyle = style.background; ctx.fillRect(0, 0, 640, 480);
      for (const hand of frame.hands) {
        const w = hand.landmarks[0], k = style.scale;
        // Wrist-centred, enlarged copy of the synthetic 21-point hand.
        const p = hand.landmarks.map(q => [320 + (q.x - w.x) * 480 * k, 360 + (q.y - w.y) * 480 * k]);
        const width = style.width * 480 * k * 0.18;
        const skin = ctx.createLinearGradient(p[0][0] - 80, p[0][1], p[0][0] + 80, p[12][1]);
        skin.addColorStop(0, "#c68a62"); skin.addColorStop(1, "#e7b892");
        ctx.fillStyle = skin; ctx.strokeStyle = skin; ctx.lineCap = "round"; ctx.lineJoin = "round";
        if (style.arm) { ctx.lineWidth = width * 2.6; ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo(p[0][0] + 20, 480 + 40); ctx.stroke(); }
        ctx.beginPath(); for (const i of [0, 1, 2, 5, 9, 13, 17]) ctx.lineTo(...p[i]); ctx.closePath(); ctx.fill();
        ctx.lineWidth = width * 1.4; ctx.beginPath(); for (const i of [0, 1, 5, 9, 13, 17, 0]) ctx.lineTo(...p[i]); ctx.stroke();
        ctx.lineWidth = width; for (const [a, b] of bones) { ctx.beginPath(); ctx.moveTo(...p[a]); ctx.lineTo(...p[b]); ctx.stroke(); }
        ctx.strokeStyle = "rgba(90,50,30,.35)"; ctx.lineWidth = 1.5; for (const [a, b] of bones.slice(4)) { ctx.beginPath(); ctx.moveTo(...p[a]); ctx.lineTo(...p[b]); ctx.stroke(); }
      }
      return canvas.transferToImageBitmap();
    };
    const track = async (indices) => {
      const worker = new Worker("/workers/fingerspelling-vision.worker.js");
      const reply = (message, transfer, kind) => new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => { if (data.type === "error") reject(new Error(data.message)); else if (data.type === kind) resolve(data); };
        worker.onerror = e => reject(new Error(e.message)); worker.postMessage(message, transfer);
      });
      try {
        await reply({ type: "init" }, [], "ready");
        const observed = [];
        for (const i of indices) {
          const bitmap = render(frames[i]);
          const { frame } = await reply({ type: "frame", bitmap, timestamp: frames[i].timestamp }, [bitmap], "result");
          observed.push({ index: i, hands: frame.hands });
        }
        return observed;
      } finally { worker.terminate(); }
    };
    const all = frames.map((_, i) => i), dropped = all.filter(i => i !== 6);
    const a = await track(all), b = await track(all), c = await track(dropped);
    const detected = a.filter(o => o.hands.length).length;
    const print = list => fingerprintObservations(list);
    // Compare the dropped run with the full run on the frames both observed.
    const after = list => list.filter(o => o.index > 6);
    const perFrame = (x, y) => x.map((o, k) => fingerprintObservations([o]) === fingerprintObservations([y[k]]));
    const sameAfterDrop = perFrame(after(a), after(c));
    const maxDelta = after(a).reduce((m, o, k) => { const q = after(c)[k];
      if (!o.hands.length || !q.hands.length) return m;
      return Math.max(m, ...o.hands[0].landmarks.map((p, j) => Math.hypot(p.x - q.hands[0].landmarks[j].x, p.y - q.hands[0].landmarks[j].y))); }, 0);
    return { frames: frames.length, framesWithDetectedHand: detected,
      identicalRepeat: print(a) === print(b), repeatFingerprints: [print(a), print(b)],
      afterOneDroppedFrame: { comparedFrames: sameAfterDrop.length, identicalFrames: sameAfterDrop.filter(Boolean).length, maxLandmarkDelta: maxDelta } };
  })()`);
  // Empty outputs are trivially identical: without detections nothing is shown.
  const conclusive = result.framesWithDetectedHand > 0;
  const summary = { kind: "rendered synthetic hands through the production CPU tracking worker; determinism only, not accuracy", conclusive,
    note: conclusive ? undefined : "No hand detected in the rendered frames; repeat/drop comparisons are of empty outputs and qualify nothing.",
    userAgent: await h.evaluate("navigator.userAgent"), ...result };
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(summary, null, 1));
  console.log("TRACKING-DETERMINISM", JSON.stringify(summary));
  if (!conclusive) process.exitCode = 2;
} finally { await h.close(); }
