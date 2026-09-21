import { expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTreeWithRetry } from "../helpers/remove-tree";

test("PUT /api/settings reports why Codex desktop switches were not applied", async () => {
  const root = mkdtempSync(join(tmpdir(), "ocx-settings-desktop-switch-"));
  const codexHome = join(root, "codex");
  mkdirSync(codexHome, { recursive: true });
  const previousOcxHome = process.env.OPENCODEX_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.OPENCODEX_HOME = join(root, "opencodex");
  process.env.CODEX_HOME = codexHome;

  const codexInject = await import("../../src/codex/inject");
  const injectionSpy = spyOn(codexInject, "injectCodexConfig").mockResolvedValue({
    success: false,
    retryable: true,
    message: "another Codex config writer owns the lock",
  });

  try {
    const [{ writeRuntimePort }, { handleManagementAPI }, { catalogConvergenceFactory }, { startupHealthFixture }] = await Promise.all([
      import("../../src/config/process-state"),
      import("../../src/server/management-api"),
      import("../helpers/catalog-convergence"),
      import("../helpers/startup-health"),
    ]);
    const config = {
      port: 10100,
      defaultProvider: "openai",
      providers: {
        openai: {
          adapter: "openai-chat" as const,
          baseUrl: "https://api.example.test/v1",
          apiKey: "sk-secret-value",
          defaultModel: "gpt-test",
        },
      },
    };
    writeRuntimePort({ pid: process.pid, port: config.port });
    const request = new Request("http://127.0.0.1:10100/api/settings", {
      method: "PUT",
      // `host` is not optional here. `managementRequestOrigin` derives the allowed origin
      // from the Host header, and an in-process `new Request` carries none, so the settings
      // handler is never reached and the response is a 403 cross-origin rejection.
      headers: { host: "127.0.0.1:10100", "content-type": "application/json" },
      body: JSON.stringify({ codexDesktopAuthless: true }),
    });
    const response = await handleManagementAPI(request, new URL(request.url), config, {
      saveConfigPreservingClaudeCode: () => {},
      getCachedStartupHealth: async () => startupHealthFixture(),
      createManagementConvergeCodex: catalogConvergenceFactory(() => {}),
    });

    expect(response!.status).toBe(200);
    expect(await response!.json()).toMatchObject({
      codexDesktopAuthless: true,
      codexDesktopSwitches: {
        apply: {
          applied: false,
          reason: "write_lock_busy",
          retryable: true,
          detail: "another Codex config writer owns the lock",
        },
      },
    });
    expect(injectionSpy).toHaveBeenCalledTimes(1);

    injectionSpy.mockResolvedValue({
      success: true,
      configApplied: false,
      message: 'Codex routing NOT injected: external model_provider "custom" owns config.toml.',
    });
    const externalRequest = new Request("http://127.0.0.1:10100/api/settings", {
      method: "PUT",
      headers: { host: "127.0.0.1:10100", "content-type": "application/json" },
      body: JSON.stringify({ codexClientCompaction: true }),
    });
    const externalResponse = await handleManagementAPI(
      externalRequest,
      new URL(externalRequest.url),
      config,
      {
        saveConfigPreservingClaudeCode: () => {},
        getCachedStartupHealth: async () => startupHealthFixture(),
        createManagementConvergeCodex: catalogConvergenceFactory(() => {}),
      },
    );

    expect(externalResponse!.status).toBe(200);
    expect(await externalResponse!.json()).toMatchObject({
      codexDesktopSwitches: {
        codexDesktopAuthless: { effective: null },
        codexClientCompaction: { effective: null },
        apply: { applied: false, reason: "external_provider", retryable: false },
        authSource: { presentsCodexAccount: null },
      },
    });
    expect(injectionSpy).toHaveBeenCalledTimes(2);
  } finally {
    injectionSpy.mockRestore();
    if (previousOcxHome === undefined) delete process.env.OPENCODEX_HOME;
    else process.env.OPENCODEX_HOME = previousOcxHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    removeTreeWithRetry(root);
  }
});
