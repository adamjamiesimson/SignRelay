import assert from "node:assert/strict";
import test from "node:test";

test("renders SignBridge metadata and every public route", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const environment = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const context = { waitUntil() {}, passThroughOnException() {} };
  const routes = ["/", "/how-it-works", "/languages", "/models", "/privacy", "/about", "/roadmap"];

  for (const route of routes) {
    const response = await worker.fetch(new Request(`http://localhost${route}`, { headers: { accept: "text/html" } }), environment, context);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.match(html, /SignBridge/i, route);
    assert.doesNotMatch(html, /codex-preview/i, route);
  }
});
