import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = new URL("../public/models/bdsl401-videomae/", import.meta.url);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const model = await readFile(new URL("model.onnx", root));
const labelsBytes = await readFile(new URL("labels.json", root));
const labels = JSON.parse(labelsBytes);
assert.equal(model.length, manifest.bytes);
assert.equal(hash(model), manifest.sha256, "Bangla model is missing or corrupt");
assert.equal(hash(labelsBytes), manifest.labelsSha256, "Bangla class mapping changed");
assert.equal(labels.length, 401);
assert.equal(new Set(labels).size, 398);
assert(labels.every(label => typeof label === "string" && label.trim()));
console.log("Bangla assets verified: 401 sign classes / 398 English glosses.");
