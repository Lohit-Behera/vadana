import { describe, expect, it } from "vitest";
import {
  fromSelectModelValue,
  resolveEffectiveLlm,
  toSelectModelValue,
  LLM_MODEL_DEFAULT_VALUE,
} from "@/lib/llmProviders";
import type { LlmProvider } from "@/lib/settings";

describe("resolveEffectiveLlm", () => {
  const global = {
    llmProvider: "lm_studio" as LlmProvider,
    lmBaseUrl: "http://127.0.0.1:1234",
    model: "global-model",
  };

  it("uses global when chat overrides empty", () => {
    expect(resolveEffectiveLlm(global, { provider: "", baseUrl: "", model: "" })).toEqual({
      provider: "lm_studio",
      baseUrl: "http://127.0.0.1:1234",
      model: "global-model",
    });
  });

  it("round-trips model default sentinel", () => {
    expect(toSelectModelValue("")).toBe(LLM_MODEL_DEFAULT_VALUE);
    expect(fromSelectModelValue(LLM_MODEL_DEFAULT_VALUE)).toBe("");
    expect(fromSelectModelValue("llama3")).toBe("llama3");
  });

  it("uses per-chat model and provider", () => {
    expect(
      resolveEffectiveLlm(global, {
        provider: "ollama",
        baseUrl: "",
        model: "llama3",
      }),
    ).toEqual({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "llama3",
    });
  });
});
