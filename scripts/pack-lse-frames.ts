import { readFileSync, writeFileSync } from "node:fs";
import { prepareLseInput } from "../lib/lse300-runtime";
import type { VisionFrame } from "../lib/vision-types";

const [input, output] = process.argv.slice(2);
const clips: VisionFrame[][] = JSON.parse(readFileSync(input, "utf8"));
writeFileSync(output, Buffer.concat(clips.map(clip => Buffer.from(prepareLseInput(clip).buffer))));
