import { VisionEngine } from "../lib/vision-engine";

// Browser QA fixture: bundle into an ephemeral out/ page, never public/.
const result = document.getElementById("result")!;
document.addEventListener("securitypolicyviolation", event => {
  const p = document.createElement("p");
  p.textContent = `CSP blocked: ${event.violatedDirective} ${event.blockedURI}`;
  document.body.appendChild(p);
});
void (async () => { try {
  const engine = await VisionEngine.create(message => { result.textContent = message; });
  engine.close();
  result.textContent = "PASS: MediaPipe hand, face and pose runtimes loaded under the production CSP. No camera used.";
} catch (error) { result.textContent = `FAIL: ${String(error)}`; } })();
