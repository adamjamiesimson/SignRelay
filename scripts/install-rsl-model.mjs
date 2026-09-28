import { readFile } from "node:fs/promises";
import { installVerifiedAsset } from "./verified-download.mjs";

const directory = new URL("../public/models/rsl1000-slovo/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8"));
console.log("Verifying Slovo pretrained model (141 MB on first installation)…");
const status = await installVerifiedAsset(new URL("model.onnx", directory), manifest);
console.log(`Slovo pretrained model ${status} and verified (1,000 sign classes).`);
