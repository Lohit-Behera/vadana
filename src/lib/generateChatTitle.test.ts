import { describe, expect, it } from "vitest";
import {
  extractOpenAiTitleText,
  sanitizeGeneratedTitle,
} from "@/lib/generateChatTitle";

describe("sanitizeGeneratedTitle", () => {
  it("strips quotes and trims length", () => {
    expect(sanitizeGeneratedTitle('"Name inquiry"')).toBe("Name inquiry");
    expect(sanitizeGeneratedTitle("  Hello   world  ")).toBe("Hello world");
  });
});

describe("extractOpenAiTitleText", () => {
  it("reads message.content", () => {
    expect(
      extractOpenAiTitleText({
        choices: [{ message: { content: "Name introduction" } }],
      }),
    ).toBe("Name introduction");
  });

  it("returns null when content empty", () => {
    expect(
      extractOpenAiTitleText({
        choices: [{ message: { content: "" } }],
      }),
    ).toBeNull();
  });
});
