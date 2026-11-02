// Runner for tracker-variants-rgb.ts (bundled for Node; see that file).
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
mkdirSync("work", { recursive: true });
const outfile = "work/tracker-variants-rgb.mjs";
await build({ entryPoints: ["scripts/diagnostics/tracker-variants-rgb.ts"], bundle: true, platform: "node", format: "esm",
  outfile, external: ["onnxruntime-web"], logLevel: "error",
  define: { "import.meta.url": JSON.stringify(new URL("./replay-fingerspelling-trace.ts", import.meta.url).href) } });
const run = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(run.status ?? 1);
