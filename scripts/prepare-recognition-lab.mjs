// QA only: never writes to public/ or changes the production application.
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { checkVisionRuntime } from "./verify-vision-runtime.mjs";
const tasksVersion = await checkVisionRuntime();
const index = await readFile("out/index.html", "utf8");
const policy = index.match(/<meta name="signrelay-csp"[^>]*>/)?.[0];
if (!policy) throw new Error("Build the secured static export first");
await mkdir("out/__qa", { recursive: true });
await build({ entryPoints: ["scripts/diagnostics/recognition-lab.ts"], bundle: true, format: "esm", platform: "browser",
  target: "es2020", define: { __TASKS_JS_VERSION__: JSON.stringify(tasksVersion) }, outfile: "out/__qa/recognition-lab.js" });
const html = await readFile("scripts/diagnostics/recognition-lab.html", "utf8");
await writeFile("out/__qa/recognition-lab.html", html.replace("<!--POLICY-->", policy));
console.log("Local QA page: /__qa/recognition-lab.html. Next production build removes it.");
