import { spawn } from "node:child_process";

// Accept the supervised preview's Vite-shaped flags without changing Next.js.
const supervised = process.argv.includes("--strictPort");
const args = process.argv.slice(2).filter(arg => arg !== "--strictPort").map(arg => arg === "--host" ? "--hostname" : arg);
// Supervised QA checks the production export; ordinary npm run dev uses Next.
const command = supervised
  ? ["scripts/serve-export.mjs", ...args]
  : ["node_modules/next/dist/bin/next", "dev", ...args];
const child = spawn(process.execPath, command, { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => process.exit(code ?? 1));
