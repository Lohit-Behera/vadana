import { describe, expect, it } from "vitest";
import { friendlyErrorMessage } from "@/lib/errorMessages";

describe("friendlyErrorMessage", () => {
  it("returns mapped text for known error codes", () => {
    expect(friendlyErrorMessage(undefined, "lm_unreachable")).toMatch(/LLM server/i);
    expect(friendlyErrorMessage(undefined, "stt_failed")).toMatch(/Speech recognition/i);
  });

  it("detects connection refused from raw message", () => {
    expect(
      friendlyErrorMessage("connect ECONNREFUSED 127.0.0.1:1234"),
    ).toMatch(/LLM server/i);
  });

  it("returns the original message when no code matches", () => {
    expect(friendlyErrorMessage("Custom backend detail")).toBe(
      "Custom backend detail",
    );
  });

  it("falls back when message is empty", () => {
    expect(friendlyErrorMessage(undefined)).toMatch(/unexpected error/i);
  });
});
