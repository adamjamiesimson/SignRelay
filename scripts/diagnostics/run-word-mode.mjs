// Runner for word-mode-rgb.ts (bundled for Node; see that file).
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
mkdirSync("work", { recursive: true });
const outfile = "work/word-mode-rgb.mjs";
await build({ entryPoints: ["scripts/diagnostics/word-mode-rgb.ts"], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
const run = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(run.status ?? 1);
