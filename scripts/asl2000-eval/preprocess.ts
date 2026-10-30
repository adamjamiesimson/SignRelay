// Isolated ASL-2000 evaluation, step 1: production TypeScript preprocessing.
// Bypasses the camera, movement gate and confirmation UI; production rules
// are untouched. Input frames never leave the machine that runs this.
//
// node preprocess.mjs cases.jsonl variants.json out-prefix
//   cases.jsonl:   {"id": string, "frames": VisionFrame[]} per line
//   variants.json: {"name": TgcnInputOptions, ...}
// Writes out-prefix.bin (float32 windows, 55 x 100 each) and out-prefix.jsonl
// ({id, variant, offset, windows}). Fails if the v1 options ever disagree with
// the shipped prepareTgcnInput, so "production" here is production.
import { createReadStream, createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { prepareTgcnInput } from "../../lib/asl1000-runtime";
import { PRODUCTION_V1_INPUT, prepareTgcnWindows, type TgcnInputOptions } from "../../lib/tgcn-input";
import type { VisionFrame } from "../../lib/vision-types";

const [casesPath, variantsPath, prefix] = process.argv.slice(2);
if (!casesPath || !variantsPath || !prefix) throw new Error("Usage: preprocess cases.jsonl variants.json out-prefix");
const variants = JSON.parse(readFileSync(variantsPath, "utf8")) as Record<string, TgcnInputOptions>;
const tensors = createWriteStream(`${prefix}.bin`);
const index: string[] = [];
let offset = 0, cases = 0, parityChecks = 0;
for await (const line of createInterface({ input: createReadStream(casesPath), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const { id, frames } = JSON.parse(line) as { id: string; frames: VisionFrame[] };
  cases++;
  const exact = prepareTgcnInput(frames, 50);
  const v1 = prepareTgcnWindows(frames, PRODUCTION_V1_INPUT)[0];
  if (exact.length !== v1.length || exact.some((value, i) => !Object.is(value, v1[i]))) {
    throw new Error(`Production v1 options differ from prepareTgcnInput for ${id}`);
  }
  parityChecks++;
  for (const [variant, options] of Object.entries(variants)) {
    const windows = prepareTgcnWindows(frames, options);
    for (const window of windows) {
      if (!tensors.write(Buffer.from(window.buffer, window.byteOffset, window.byteLength))) {
        await new Promise<void>(resolve => tensors.once("drain", () => resolve()));
      }
    }
    index.push(JSON.stringify({ id, variant, offset, windows: windows.length }));
    offset += windows.length;
  }
}
await new Promise<void>((resolve, reject) => tensors.end((error?: Error | null) => error ? reject(error) : resolve()));
writeFileSync(`${prefix}.jsonl`, index.join("\n") + "\n");
console.error(JSON.stringify({ cases, windows: offset, v1_bit_identical_to_prepareTgcnInput: parityChecks }));
