import { describe,it,expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { FINGERSPELLING_CTC_MODEL } from "../lib/fingerspelling-model";
import { CTC_VOCABULARY } from "../lib/fingerspelling-ctc-runtime";

describe("installed pilot artifact integrity (software checks, not accuracy)",()=>{
  it("ships the measured model bytes and vocabulary without substituting weights",()=>{
    const bytes=readFileSync(new URL("../public/models/asl-fingerspelling/fsboard-pilot-v1.onnx",import.meta.url));
    const report=JSON.parse(readFileSync(new URL("../docs/fingerspelling/evidence/fsboard-v13-pilot.json",import.meta.url),"utf8"));
    const digest=createHash("sha256").update(bytes).digest("hex");
    expect(digest).toBe(FINGERSPELLING_CTC_MODEL.sha256);
    expect(bytes.length).toBe(FINGERSPELLING_CTC_MODEL.bytes);
    expect(report.modelSha256).toBe(digest);
    expect(report.vocabulary).toEqual(CTC_VOCABULARY);
  });
});
