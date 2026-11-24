import * as ort from 'onnxruntime-web/wasm';
import { prepareClip, N_POINTS, TMAX } from './upstream-preprocess.mjs';
import { targetEvidence } from './verification.mjs';

let session;
let metadata;
const asset = path => new URL(path, self.location.href).href;
async function pinned(path, expected) {
  const response = await fetch(asset(path));
  if (!response.ok) throw new Error('Missing ' + path + ' (' + response.status + ')');
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== expected) throw new Error('Fingerprint mismatch for ' + path);
  return bytes;
}

async function initialize() {
  const [bytes, model] = await Promise.all([
    pinned('model/meta.json', '50d59fdada18cc5c43ac61585f3af9c81d828402e2c2ba27c5ebeae86489ad22'),
    pinned('model/model.onnx', 'b3e05424f4674d8235ac8bc51970cef6822e12ac629c4a02bca596bc7f5d3090'),
  ]);
  metadata = JSON.parse(new TextDecoder().decode(bytes));
  metadata.prototypes = new Float32Array(Uint8Array.from(atob(metadata.prototypes_b64), ch => ch.charCodeAt(0)).buffer);
  metadata.indices = new Map(metadata.classes.map((name, index) => [name.toLowerCase(), index]));
  ort.env.wasm.wasmPaths = asset('ort/');
  ort.env.wasm.numThreads = 1;
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const neutral = Float32Array.from({ length: N_POINTS * 3 }, (_, index) => index < 63 ? 0 : NaN);
  await verify({ windows: [[neutral]], targets: [] });
}

async function verify({ windows, targets }) {
  const indices = targets.map(target => metadata.indices.get(target) ?? -1);
  const best = targets.map(() => ({ score: 0, p: 0, cosine: 0, unknown: 0 }));
  for (const frames of windows) {
    const clip = prepareClip(frames);
    if (!clip) continue;
    const feeds = {
      x: new ort.Tensor('float32', clip.x, [1, TMAX, N_POINTS, 3]),
      valid: new ort.Tensor('float32', clip.valid, [1, TMAX, N_POINTS]),
      fmask: new ort.Tensor('float32', clip.fmask, [1, TMAX]),
    };
    let output;
    try {
      output = await session.run(feeds);
      const values = targetEvidence(output.logits.data, output.embedding.data, metadata, indices);
      values.forEach((value, index) => {
        if (value.score > best[index].score || (value.score === best[index].score && value.p > best[index].p)) best[index] = value;
      });
    } finally {
      for (const tensor of [...Object.values(feeds), ...Object.values(output ?? {})]) tensor.dispose();
    }
  }
  return best;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      await initialize();
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'verify') {
      const start = performance.now();
      const values = await verify(data);
      self.postMessage({ type: 'verified', id: data.id, timestamp: data.timestamp, values, ms: Math.round(performance.now() - start) });
    }
  } catch (error) {
    self.postMessage({ type: 'error', detail: error.message || String(error) });
  }
};

