// Automated WCAG 2.x A/AA checks with axe-core on the public pages and the live
// ASL workspace (camera on, no hands). axe-core is installed with --no-save in
// CI rather than added as a dependency. Automated checks are not a substitute
// for testing with real screen readers.
// Usage: node tests/a11y-axe-smoke.mjs CHROME node_modules/axe-core/axe.min.js
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";
const axe = readFileSync(process.argv[3], "utf8");
const port = 18600 + Math.floor(Math.random() * 100), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--port", String(port)], { stdio: "ignore"});
const pause = ms => new Promise(r => setTimeout(r, ms));
await pause(1500);
const browser = await startChrome(process.argv[2]);
const results = {};
try {
  const run = async (label) => {
    await browser.evaluate(axe);
    const out = await browser.evaluate(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map(n => n.target.join(" ") + " :: " + (n.failureSummary || "").split("\\n").slice(1, 2).join("")) })))`);
    results[label] = out;
  };
  for (const path of ["/", "/languages", "/models", "/privacy", "/about"]) {
    await browser.send("Page.navigate", { url: origin + path }); await pause(2500); await run(path);
  }
  await browser.send("Page.navigate", { url: origin + "/" }); await pause(2000);
  for (let i = 0; i < 30; i++) {
    await browser.evaluate("[...document.querySelectorAll('[role=radio]')].find(b=>b.textContent.includes('British'))?.click()");
    if (await browser.evaluate("document.querySelector('[role=radio][aria-checked=true]')?.textContent.includes('British')")) break;
    await pause(200);
  }
  await browser.evaluate("[...document.querySelectorAll('[role=radio]')].find(b=>b.textContent.includes('American'))?.click()");
  await pause(300);
  await browser.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Start translating')?.click()");
  await pause(6000);
  await run("workspace (camera active, no hands)");
  const violations = Object.entries(results).flatMap(([page, list]) => list.map(item => ({ page, ...item })));
  console.log(JSON.stringify({ passed: violations.length === 0, pages: Object.keys(results), violations }, null, 1));
  if (violations.length) process.exitCode = 1;
} finally { await browser.close(); server.kill(); }
