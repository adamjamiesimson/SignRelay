import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// Pin the reviewed 24-epoch candidate, including its exact class order.
const directory = new URL("../public/models/lse300-swl/", import.meta.url);
const expected = {
  "model.onnx": "58ce0f861f7e095054386435bf1a506b933a68883befee60a33c163a152d0ae3",
  "labels.json": "5cda31c42d0f9e45788d323c8d7f5af8c18bec9baf6178f0bfde428552038eff",
};
for (const [name, hash] of Object.entries(expected)) {
  const bytes = await readFile(new URL(name, directory));
  if (createHash("sha256").update(bytes).digest("hex") !== hash) {
    throw new Error(`Spanish model asset failed integrity verification: ${name}`);
  }
}
const metadata = JSON.parse(await readFile(new URL("model.json", directory), "utf8"));
const labels = JSON.parse(await readFile(new URL("labels.json", directory), "utf8"));
if (metadata.sha256 !== expected["model.onnx"] || metadata.classes !== 300
  || metadata.sequenceLength !== 64 || metadata.inputFeatures !== 183 || !metadata.exportVerified
  || labels.length !== 300 || new Set(labels).size !== 300) {
  throw new Error("Spanish model metadata does not match the installed checkpoint");
}
console.log("Spanish model and all 300 labels match the reviewed training artifact.");
