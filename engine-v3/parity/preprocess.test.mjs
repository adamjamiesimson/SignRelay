// node --test: browser preprocessing equals the Python reference on real landmark clips.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareClip, resampleTo15Hz, N_POINTS } from "../web/preprocess.mjs";
const cases = JSON.parse(readFileSync(process.env.FIXTURE ?? "/home/user/data/preprocess-fixture.json", "utf8"));
const frames = (flat, T) => Array.from({ length: T }, (_, t) => Float32Array.from(flat.slice(t * N_POINTS * 3, (t + 1) * N_POINTS * 3), v => (v === null ? NaN : v)));
const maxErr = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) { const x = a[i] ?? NaN, y = b[i] ?? NaN; if (Number.isNaN(x) !== Number.isNaN(y)) return Infinity; if (!Number.isNaN(x)) m = Math.max(m, Math.abs(x - y)); } return m; };
test("prepareClip matches Python prepare_clip", () => {
  for (const c of cases) {
    const p = prepareClip(frames(c.raw, c.T));
    if (c.prep === null) { assert.equal(p, null); continue; }
    assert.ok(maxErr(p.x, c.prep.x) < 1e-6); assert.ok(maxErr(p.valid, c.prep.valid) === 0); assert.ok(maxErr(p.fmask, c.prep.fmask) === 0);
  }
});
test("resampleTo15Hz matches Python resample_to_15hz", () => {
  for (const c of cases) {
    const f = frames(c.raw, c.T);
    const out = resampleTo15Hz(c.ts.map((t, i) => ({ t, f: f[i] })));
    assert.equal(out.length, c.R);
    const flat = out.flatMap(a => Array.from(a, v => (Number.isNaN(v) ? null : v)));
    assert.ok(maxErr(flat, c.resampled) < 1e-4, `max err ${maxErr(flat, c.resampled)}`);
  }
});
