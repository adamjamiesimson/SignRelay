import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const contract = JSON.parse(readFileSync("docs/gitex/demo-contract.json", "utf8"));

describe("GITEX demo contract is machine-checkable", () => {
  it.each(contract.automated.map((item: { id: string }) => [item.id, item]))("%s points at an existing automated check", (_id, item) => {
    const { file, contains } = (item as { check: { file: string; contains: string } }).check;
    expect(existsSync(file), file).toBe(true);
    expect(readFileSync(file, "utf8"), `${file} must contain the cited check`).toContain(contains);
  });
  it("keeps automated and manual criteria distinct and uniquely identified", () => {
    const ids = [...contract.automated, ...contract.manual_before_demo].map((item: { id: string }) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(contract.manual_before_demo.every((item: { check?: unknown }) => !item.check)).toBe(true);
  });
  it("never lists validated accuracy or sentence translation as in scope", () => {
    expect(contract.scope).not.toMatch(/validated accuracy is|translates sentences/i);
    expect(contract.not_claimed.join(" ")).toMatch(/Measured accuracy/);
  });
});
