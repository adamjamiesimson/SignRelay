// Research CLI used by the independent Python preprocessing comparison.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { packBdslFrames } from "../lib/bdsl-video";

const [manifestPath, destination] = process.argv.slice(2);
if (!manifestPath || !destination) throw new Error("Supply frame manifest and tensor output paths");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { frames: { path: string; width: number; height: number }[] };
const frames = manifest.frames.map(frame => ({ width: frame.width, height: frame.height, rgba: new Uint8ClampedArray(readFileSync(resolve(manifestPath, "..", frame.path))) }));
const values = packBdslFrames(frames);
writeFileSync(destination, Buffer.from(values.buffer));
