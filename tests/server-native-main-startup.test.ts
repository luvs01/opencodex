import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const previousOpencodexHome = process.env.OPENCODEX_HOME;
const previousCodexHome = process.env.CODEX_HOME;
let root: string | undefined;

afterEach(() => {
  if (previousOpencodexHome === undefined) delete process.env.OPENCODEX_HOME;
  else process.env.OPENCODEX_HOME = previousOpencodexHome;
  if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previousCodexHome;
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

test("Codex integration OFF still evaluates the native-main recovery gate", async () => {
  root = mkdtempSync(join(tmpdir(), "ocx-disabled-native-main-"));
  const opencodexHome = join(root, "opencodex");
  const codexHome = join(root, "codex");
  mkdirSync(opencodexHome, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  process.env.OPENCODEX_HOME = opencodexHome;
  process.env.CODEX_HOME = codexHome;
  writeFileSync(join(opencodexHome, "config.json"), JSON.stringify({
    port: 0,
    hostname: "127.0.0.1",
    providers: {},
    defaultProvider: "openai",
    clientIntegrations: { codex: false },
    checkForUpdates: false,
  }));

  const [{ NativeProfileManager }, { nativeMainStartupGateSnapshot }, { startServer }] = await Promise.all([
    import("../src/codex/native-profile-manager"),
    import("../src/codex/native-profile-startup"),
    import("../src/server/index"),
  ]);
  const manager = new NativeProfileManager({ codexHome, configDir: opencodexHome });
  let probeCalls = 0;
  const server = startServer(0, {
    nativeMainStartup: {
      manager,
      probeRecoveryState: () => {
        probeCalls += 1;
        return "manual";
      },
    },
  });
  try {
    const gate = await Promise.race([
      (async () => {
        while (probeCalls === 0) await Bun.sleep(10);
        return nativeMainStartupGateSnapshot();
      })(),
      Bun.sleep(5_000).then(() => { throw new Error("native-main recovery probe did not run"); }),
    ]);
    expect(probeCalls).toBe(1);
    expect(gate).toEqual({ status: "blocked", homeId: manager.context.homeId, reason: "manual-recovery" });
  } finally {
    await server.stop(true);
  }
});
