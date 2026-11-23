// The private ASL capture studio is development tooling, not a public feature.
// `noindex` is not access control, so public exports omit it entirely.
// Set SIGNRELAY_INCLUDE_PRIVATE_CAPTURE=1 only for local/CI synthetic-camera
// tests; such an export is marked and refused by the deploy script.
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const PRIVATE_ROUTES = ["field-test"];
export const PRIVATE_EXPORT_MARKER = ".signrelay-private-capture-included";

async function files(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(path));
    else found.push(path);
  }
  return found;
}

const assetRefs = text => new Set([...text.matchAll(/\/_next\/static\/[^"'\s\\)]+/g)].map(match => match[0]));
const isRouteFile = (root, path, route) => {
  const name = relative(root, path).split(/[\\/]/);
  return name[0] === route || name[0] === `${route}.html` || name[0] === `${route}.txt`;
};

export async function excludePrivateRoutes(root = "out", routes = PRIVATE_ROUTES) {
  const all = await files(root);
  const documents = all.filter(path => /\.(?:html|txt)$/.test(path));
  const privateDocs = documents.filter(path => routes.some(route => isRouteFile(root, path, route)));
  const publicDocs = documents.filter(path => !privateDocs.includes(path));
  const publicRefs = new Set();
  for (const path of publicDocs) for (const ref of assetRefs(await readFile(path, "utf8"))) publicRefs.add(ref);
  const privateOnly = new Set();
  for (const path of privateDocs) for (const ref of assetRefs(await readFile(path, "utf8"))) if (!publicRefs.has(ref)) privateOnly.add(ref);

  for (const route of routes) for (const target of [route, `${route}.html`, `${route}.txt`]) await rm(join(root, target), { recursive: true, force: true });
  const removedAssets = [];
  for (const ref of privateOnly) {
    const path = join(root, ref);
    if (await stat(path).catch(() => null)) { await rm(path, { force: true }); removedAssets.push(ref); }
  }
  // A public page that still links the private route would be a broken link
  // and a pointer to tooling that is not deployed.
  const leaks = [];
  for (const path of publicDocs) {
    const text = await readFile(path, "utf8");
    for (const route of routes) if (new RegExp(`["'(/]${route}(?:["'/?#.)]|$)`).test(text)) leaks.push(`${relative(root, path)} references /${route}`);
  }
  if (leaks.length) throw new Error(`Public export still references private routes:\n${leaks.join("\n")}`);
  return { removedRoutes: routes, removedDocuments: privateDocs.length, removedAssets };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.SIGNRELAY_INCLUDE_PRIVATE_CAPTURE === "1") {
    await writeFile(join("out", PRIVATE_EXPORT_MARKER), "This export includes /field-test for local synthetic tests. Do not deploy.\n");
    console.warn("Development export: /field-test included and marked. Do not deploy this out/ directory.");
  } else {
    await rm(join("out", PRIVATE_EXPORT_MARKER), { force: true });
    const result = await excludePrivateRoutes();
    console.log(`Public export: removed private /${result.removedRoutes.join(", /")} (${result.removedDocuments} documents, ${result.removedAssets.length} route-only assets).`);
  }
}
