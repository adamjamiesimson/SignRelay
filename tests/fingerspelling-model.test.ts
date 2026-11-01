import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {FINGERSPELLING_CTC_MODEL,FINGERSPELLING_BASELINE_MODEL} from "../lib/fingerspelling-model";
import {CTC_VOCABULARY} from "../lib/fingerspelling-ctc-runtime";
function artifact(contract:{url:string;bytes:number;sha256:string}){
 const bytes=readFileSync(new URL("../public"+contract.url,import.meta.url));
 expect(bytes.length).toBe(contract.bytes);expect(createHash("sha256").update(bytes).digest("hex")).toBe(contract.sha256);
}
describe("installed research artifacts (software integrity, not recognition accuracy)",()=>{
 it("pins the evaluated motion model and its non-qualifying calibration policy",()=>{
  artifact(FINGERSPELLING_CTC_MODEL);
  const report=JSON.parse(readFileSync(new URL("../docs/fingerspelling/evidence/upright-final.json",import.meta.url),"utf8"));
  expect(report.selection.modelSha256).toBe(FINGERSPELLING_CTC_MODEL.sha256);
  expect(report.runtime.calibration.means).toEqual(FINGERSPELLING_CTC_MODEL.calibration?.means);
  expect(FINGERSPELLING_CTC_MODEL.policy?.threshold).toBe(null);
  expect(FINGERSPELLING_CTC_MODEL.policy?.reviewOnly).toBe(true);
  expect(report.roles.final.selected.sequences).toBe(384);
 });
 it("retains the exact historical checkpoint and vocabulary for rollback",()=>{
  artifact(FINGERSPELLING_BASELINE_MODEL);
  const report=JSON.parse(readFileSync(new URL("../docs/fingerspelling/evidence/fsboard-v13-pilot.json",import.meta.url),"utf8"));
  expect(report.modelSha256).toBe(FINGERSPELLING_BASELINE_MODEL.sha256);expect(report.vocabulary).toEqual(CTC_VOCABULARY);
 });
});
