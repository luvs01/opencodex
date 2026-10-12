/** Isolated wiring contract: run directly with Bun, not inside a shared test process. */
import { mock } from "bun:test";
import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.argv.includes("--child")) {
  const result = spawnSync(process.execPath, ["--no-env-file", import.meta.path, "--child"], {
    input: [{ id: "extra", op: "start-extra-server" }, { id: "stop", op: "stop" }]
      .map(value => JSON.stringify(value)).join("\n") + "\n",
    encoding: "utf8", timeout: 10_000,
    env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /native owner restart contract:.*passed/);
  console.log("native owner restart contract passed in an isolated mock-server child");
  process.exit(0);
}

const repo = resolve(import.meta.dir, "../../../../..");
const root = mkdtempSync(join(tmpdir(), "ocx-native-owner-restart-contract-"));
const previous = { ...process.env };
const realFetch = globalThis.fetch;
const optionsSeen: Array<{
  managementApi: {
    nativeProfileApi: { manager: unknown };
    codexRestartService?: {
      readState(): Promise<unknown>;
      performRestart(): Promise<unknown>;
    };
  };
}> = [];
let stopCount = 0;
let networkCalls = 0;
const refusal = /desktop process control is unavailable in this fixture/;

try {
  const home = join(root, "codex");
  const config = join(root, "config");
  mkdirSync(home);
  mkdirSync(config);
  process.env.NATIVE_OWNER_CODEX_HOME = home;
  process.env.NATIVE_OWNER_CONFIG_DIR = config;
  process.env.NATIVE_OWNER_KEY = Buffer.alloc(32, 7).toString("base64");
  delete process.env.NATIVE_OWNER_HOLD_RECOVERY;
  delete process.env.NATIVE_OWNER_HOLD_SWITCH_BOUNDARY;
  delete process.env.NATIVE_OWNER_HOLD_AUTH_TEMP;
  delete process.env.NATIVE_OWNER_RECEIPTS;
  // The safety boundary must not depend on the ordinary runner arming its home guard.
  delete process.env.OCX_TEST_HOME_GUARD;
  globalThis.fetch = (async () => {
    networkCalls++;
    throw new Error("network access is forbidden in this wiring contract");
  }) as typeof fetch;

  mock.module(resolve(repo, "src/config"), () => ({ atomicWriteFileAsync: async () => {} }));
  mock.module(resolve(repo, "src/codex/main-account"), () => ({ MAIN_CODEX_ACCOUNT_ID: "__main__" }));
  mock.module(resolve(repo, "src/codex/native-main-owner"), () => ({ nativeMainOwnerSnapshot: () => ({}) }));
  mock.module(resolve(repo, "src/codex/native-profile-startup"), () => ({ nativeMainStartupGateSnapshot: () => ({}) }));
  mock.module(resolve(repo, "src/codex/native-profile-manager"), () => ({
    NativeProfileManager: class { context = { homeId: "synthetic-owner" }; },
  }));
  mock.module(resolve(repo, "src/server"), () => ({
    drainAndShutdown: async () => {},
    startServer: (_port: number, options: typeof optionsSeen[number]) => {
      optionsSeen.push(options);
      return { port: 12345, stop: async () => { stopCount++; } };
    },
  }));
  await import(pathToFileURL(resolve(repo, "tests/helpers/native-main-owner-child.ts")).href);

  assert.equal(optionsSeen.length, 2, "primary and additional servers must share the safety override");
  assert.equal(stopCount, 2, "both synthetic servers still shut down normally");
  for (const options of optionsSeen) {
    assert.ok(options.managementApi.nativeProfileApi.manager, "profile fixture remains connected");
    const injected = options.managementApi.codexRestartService;
    assert.ok(injected, "must inject a restart service instead of loading the installed desktop");
    const service = injected;
    await assert.rejects(service.readState(), refusal);
    await assert.rejects(service.performRestart(), refusal);
  }
  assert.equal(networkCalls, 0);
  console.log("native owner restart contract: primary/additional server refusal and cleanup passed");
} finally {
  globalThis.fetch = realFetch;
  for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name];
  Object.assign(process.env, previous);
  rmSync(root, { recursive: true, force: true });
}
