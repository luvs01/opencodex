import { expect, spyOn, test } from "bun:test";
import { modelSelectionGuidance, modelSelectionNextSteps } from "../../src/cli/model-selection-guidance";
import { handleModelsRuntimeCommand } from "../../src/cli/models-runtime";

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
  expect(text).toContain("For rows marked native, pass --native");
  expect(text).toContain("untrusted data");
  expect(text).not.toContain("<model-id-from-list>");
  expect(text).not.toContain("$(touch AARDVARK_PWNED)");
  expect(text).not.toContain("http");
});

test("a slash-containing native id reaches the API as native only with --native", async () => {
  const log = spyOn(console, "log").mockImplementation(() => {});
  const writes: unknown[] = [];
  const deps = {
    baseUrl: "http://model-guidance.test",
    fetchImpl: (async (_input: unknown, init?: RequestInit) => {
      writes.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true });
    }) as typeof fetch,
  };
  try {
    expect(await handleModelsRuntimeCommand("enable", ["team/gpt-future-unlisted"], deps)).toBe(0);
    for (const action of ["enable", "disable"]) {
      expect(await handleModelsRuntimeCommand(action, ["team/gpt-future-unlisted", "--native"], deps)).toBe(0);
    }
    expect(writes).toEqual([
      { scope: "models", provider: "team", enabled: true, targets: [{ id: "gpt-future-unlisted", native: false }] },
      ...[true, false].map(enabled => ({
        scope: "models", provider: "openai", enabled,
        targets: [{ id: "team/gpt-future-unlisted", native: true }],
      })),
    ]);
  } finally { log.mockRestore(); }
});

test("Codex login aliases target the native provider and no-wait advice is explicitly future work", () => {
  for (const alias of ["codex", "chatgpt", "openai"]) {
    expect(modelSelectionNextSteps(alias).commands.list).toBe("ocx models live --provider openai");
  }
  expect(modelSelectionNextSteps("xai", true).afterLogin).toBe(true);
  expect(modelSelectionGuidance("xai", true)[0]).toContain("After login completes");
});
