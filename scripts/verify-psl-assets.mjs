import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// Pin the generated PSL bundle so a stale or corrupted asset fails the build
// instead of shipping silently.
const directory = new URL("../public/models/psl776-hfad/", import.meta.url);
const expected = {
  "templates.json.gz": "2cdcf70981178c6739392764846b7ef153fe993ab8d39c95792fd5665e462a14",
  "labels.json": "de1f557f09b7e192e6109c2f2fd858084f59b5f38b9236dd4fb41f013adacd8d",
};
for (const [name, hash] of Object.entries(expected)) {
  const bytes = await readFile(new URL(name, directory));
  if (createHash("sha256").update(bytes).digest("hex") !== hash) {
    throw new Error(`PSL template asset failed integrity verification: ${name}`);
  }
}
const labels = JSON.parse(await readFile(new URL("labels.json", directory), "utf8"));
if (labels.length !== 775 || new Set(labels).size !== 775) {
  throw new Error("PSL labels do not match the reviewed 775-sign bundle");
}
console.log("PSL template bundle and all 775 labels match the reviewed dataset build.");
