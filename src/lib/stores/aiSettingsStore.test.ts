import { describe, expect, it } from "vitest";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "./aiSettingsStore";

describe("AI description preferences", () => {
  it("are disabled by default so no text can be sent without an opt-in", () => {
    expect(DEFAULT_AI_SETTINGS).toEqual({ enabled: false, provider: "openai", language: "auto" } satisfies AiSettings);
  });
});
