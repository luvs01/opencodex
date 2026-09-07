import { expect, test } from "bun:test";
import { modelSelectionGuidance, modelSelectionNextSteps } from "../../src/cli/model-selection-guidance";

test("registration guidance uses real CLI model commands without shell templates for model IDs", () => {
  const next = modelSelectionNextSteps("openrouter");
  expect(next.commands).toEqual({
    list: "ocx models live --provider openrouter",
    enableAll: "ocx models provider openrouter on",
    disableAll: "ocx models provider openrouter off",
  });
  expect(next.requiresRunningProxy).toBe(true);
  const text = modelSelectionGuidance("openrouter").join("\n");
  expect(text).toContain("ocx start");
  expect(text).toContain("the provider stays active");
  expect(text).toContain("ocx models --help");
  expect(text).toContain("untrusted data");
  expect(text).not.toContain("<model-id-from-list>");
  expect(text).not.toContain("$(touch AARDVARK_PWNED)");
  expect(text).not.toContain("http");
});

test("Codex login aliases target the native provider and no-wait advice is explicitly future work", () => {
  for (const alias of ["codex", "chatgpt", "openai"]) {
    expect(modelSelectionNextSteps(alias).commands.list).toBe("ocx models live --provider openai");
  }
  expect(modelSelectionNextSteps("xai", true).afterLogin).toBe(true);
  expect(modelSelectionGuidance("xai", true)[0]).toContain("After login completes");
});
