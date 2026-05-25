import { describe, expect, it } from "vitest";
import {
  SUPERTONIC_DEFAULT_VALUE,
  SUPERTONIC_LANGUAGES,
  SUPERTONIC_VOICES,
  fromSelectLangValue,
  fromSelectVoiceValue,
  normalizeSupertonicLang,
  normalizeSupertonicVoice,
  toSelectLangValue,
  toSelectVoiceValue,
} from "@/lib/supertonicOptions";

describe("supertonicOptions", () => {
  it("includes all requested language codes", () => {
    const codes = new Set(SUPERTONIC_LANGUAGES.map((l) => l.code));
    expect(codes.has("en")).toBe(true);
    expect(codes.has("ko")).toBe(true);
    expect(codes.has("vi")).toBe(true);
    expect(codes.size).toBe(31);
  });

  it("includes F and M voice ids", () => {
    const ids = SUPERTONIC_VOICES.map((v) => v.id);
    expect(ids).toEqual(["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"]);
  });

  it("normalizes unknown values", () => {
    expect(normalizeSupertonicVoice("")).toBe("F2");
    expect(normalizeSupertonicVoice("m3")).toBe("M3");
    expect(normalizeSupertonicLang("xx")).toBe("en");
    expect(normalizeSupertonicLang("hi")).toBe("hi");
  });

  it("round-trips chat default sentinel", () => {
    expect(toSelectVoiceValue("")).toBe(SUPERTONIC_DEFAULT_VALUE);
    expect(fromSelectVoiceValue(SUPERTONIC_DEFAULT_VALUE)).toBe("");
    expect(toSelectLangValue("")).toBe(SUPERTONIC_DEFAULT_VALUE);
    expect(fromSelectLangValue("ko")).toBe("ko");
  });
});
