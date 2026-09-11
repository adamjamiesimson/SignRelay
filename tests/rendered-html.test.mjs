import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const routes = ["index", "how-it-works", "languages", "models", "privacy", "terms", "about", "roadmap", "404"];
test("public pages contain metadata, working internal links, image alternatives and script protection", async () => {
  for (const route of routes) {
    const html = await readFile(`out/${route}.html`, "utf8");
    assert.match(html, /<title>[^<]+<\/title>/, route);
    assert.match(html, /name="description" content="[^"]+"/, route);
    assert.match(html, /<head><meta name="signrelay-csp"/, route);
    const policy = html.match(/name="signrelay-csp"[^>]*content="([^"]+)"/)[1];
    assert.match(policy, /script-src-attr 'none'/);
    assert.doesNotMatch(policy.match(/script-src [^;]+/)[0], /'unsafe-inline'|'unsafe-eval'/);
    for (const [, attrs, content] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/\bsrc\s*=/i.test(attrs) && content) assert.ok(policy.includes(createHash("sha256").update(content).digest("base64")), `${route}: unsigned script`);
    }
    for (const [img] of html.matchAll(/<img\b[^>]*>/g)) assert.match(img, /\balt="[^"]*"/, `${route}: image alternative`);
    for (const [, href] of html.matchAll(/(?:href|src)="(\/[^"?#]*)(?:[?#][^"]*)?"/g)) {
      if (href.startsWith("//")) continue;
      const file = resolve("out", `.${href === "/" ? "/index.html" : href}`);
      const direct = await stat(file).catch(() => null);
      const exists = direct?.isFile() ? direct : await stat(`${file}.html`).catch(() => null);
      assert.ok(exists?.isFile(), `${route}: missing ${href}`);
    }
  }
});

test("export excludes sensitive files and source maps; Firebase protects responses", async () => {
  async function visit(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      assert.doesNotMatch(e.name, /^\.env|\.(?:map|pem|key|log|sqlite|db|bak)$/i);
      assert.doesNotMatch(e.name, /^(?:mobile-check|speed-check|page-timing|security-runtime-check)\./, "QA fixtures must not ship");
      if (e.isDirectory()) await visit(`${dir}/${e.name}`);
    }
  }
  await visit("out");
  const config = JSON.parse(await readFile("firebase.json", "utf8"));
  assert.equal(config.hosting.public, "out");
  const headers = Object.fromEntries(config.hosting.headers.find(h => h.source === "**").headers.map(h => [h.key, h.value]));
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(await readFile("out/sitemap.xml", "utf8"), /https:\/\/signrelay.web.app\/terms/);
  assert.match(await readFile("out/robots.txt", "utf8"), /Sitemap: https:\/\/signrelay.web.app\/sitemap.xml/);
});
