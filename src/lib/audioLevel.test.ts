import { describe, expect, it } from "vitest";
import { normalizeAudioLevel } from "./audioLevel";

describe("normalizeAudioLevel", () => {
  it("leaves quiet levels mostly unchanged", () => {
    expect(normalizeAudioLevel(0)).toBe(0);
    expect(normalizeAudioLevel(0.2)).toBeCloseTo(0.2, 2);
    expect(normalizeAudioLevel(0.4)).toBeCloseTo(0.4, 2);
  });

  it("compresses loud peaks without flattening everything", () => {
    expect(normalizeAudioLevel(1)).toBeLessThan(0.85);
    expect(normalizeAudioLevel(1)).toBeGreaterThan(0.55);
    expect(normalizeAudioLevel(0.7)).toBeGreaterThan(0.5);
  });
});
