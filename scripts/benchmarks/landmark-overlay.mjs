// Real Canvas 2D submission benchmark. Landmarks are synthetic, with no camera.
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { startChrome } from "../diagnostics/chrome-session.mjs";

const [chrome, baseline, output] = process.argv.slice(2);
if (!chrome || !baseline || !output) throw new Error("Usage: node scripts/benchmarks/landmark-overlay.mjs <chrome> <baseline SHA> <output.json>");
const file = execFileSync("git", ["show", `${baseline}:components/translator-experience.tsx`], { encoding: "utf8" });
const start = file.indexOf("    const drawPoints =");
const end = file.indexOf("  }, []);", start);
if (start < 0 || end < 0) throw new Error("Could not extract baseline overlay");
const source = await build({ bundle: true, write: false, format: "esm", stdin: { loader: "ts", resolveDir: process.cwd(), contents: `
  import { drawLandmarkOverlay } from './lib/landmark-overlay';
  function baselineDraw(context, canvas, frame) {
    ${file.slice(start, end)}
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const context = canvas.getContext('2d');
  const points = (n, x, y, scale) => Array.from({length:n}, (_, i) => ({
    x:x+Math.cos(i*2.4)*scale, y:y+Math.sin(i*2.4)*scale, z:0,
  }));
  const frames = Array.from({length:64}, (_, i) => ({ timestamp:i*33,
    hands:[{landmarks:points(21,.4+Math.sin(i*.6)*.24,.4,.04)}, {landmarks:points(21,.6,.45+Math.cos(i*.4)*.24,.04)}],
    face:points(20,.5,.25,.06), pose:points(33,.5,.56,.19),
  }));
  window.measure = (variant, batches) => Array.from({length:batches}, (_, batch) => {
    const start = performance.now();
    for (let i=0;i<12;i++) {
      const frame=frames[(batch*12+i)%frames.length];
      context.clearRect(0,0,canvas.width,canvas.height);
      if (variant==='baseline') baselineDraw(context,canvas,frame);
      else drawLandmarkOverlay(context,canvas.width,canvas.height,frame);
    }
    return (performance.now()-start)/12;
  });
` } });
const server = createServer((request, response) => {
  if (request.url === "/bench.js") return response.writeHead(200, { "Content-Type": "text/javascript" }).end(source.outputFiles[0].contents);
  response.writeHead(200, { "Content-Type": "text/html" }).end('<script type="module" src="/bench.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await startChrome(chrome, { proxy: "http://127.0.0.1:9" });
  await browser.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
  for (let i=0; i<100 && !await browser.evaluate('typeof window.measure === "function"'); i++) await new Promise(resolve => setTimeout(resolve, 100));
  const measurements = { baseline: [], candidate: [] };
  for (const version of Object.keys(measurements)) await browser.evaluate(`measure(${JSON.stringify(version)}, 20)`);
  for (let pair = 0; pair < 6; pair++) {
    for (const version of pair % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
      measurements[version].push(...await browser.evaluate(`measure(${JSON.stringify(version)}, 24)`));
    }
  }
  const summary = values => {
    const sorted = values.slice().sort((a,b) => a-b), q = p => sorted[Math.ceil(p*sorted.length)-1];
    return { batches: values.length, medianMs: q(.5), p95Ms: q(.95), p99Ms: q(.99) };
  };
  await writeFile(output, JSON.stringify({ baseline, browser: await browser.send("Browser.getVersion"), framesPerBatch: 12,
    workload: "Two synthetic moving hands, face and pose, 1280×720 Canvas 2D commands. Measures submission time; excludes camera, tracking, GPU presentation, and recognition.",
    results: Object.fromEntries(Object.entries(measurements).map(([version, values]) => [version, summary(values)])), measurements }, null, 2) + "\n");
} finally {
  try { await browser?.close(); } finally { server.closeAllConnections(); server.close(); }
}
