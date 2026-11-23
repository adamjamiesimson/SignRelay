import { describe, expect, it } from "vitest";
import { readable } from "../lib/lse300-runtime";
import labels from "../public/models/lse300-swl/labels.json";

describe("Spanish sign display labels", () => {
  it("removes dataset variant metadata without changing model class glosses", () => {
    expect(readable("ACCIDENTE(A)")).toBe("Accidente");
    expect(readable("ALERGIA2")).toBe("Alergia");
    expect(readable("AGUA^ALCOHOL")).toBe("Agua Alcohol");
    expect(readable("ANALISIS-DE-SANGRE(2)")).toBe("Analisis De Sangre");
    expect(readable("CIRCULACIÓN.BRAZO^MENOS")).toBe("Circulación Brazo Menos");
  });
  it("preserves accents and produces clean readable text for all model labels", () => {
    expect(readable("RIÑÓN")).toBe("Riñón");
    for (const label of labels) {
      const display = readable(label);
      expect(display).toMatch(/\p{L}/u);
      expect(display).not.toMatch(/[\^()0-9]/u);
    }
  });
});
