import { runKeychainRequest } from "../../src/claude/keychain-process";
import type { KeychainRequest } from "../../src/claude/keychain-protocol";

export const FIXTURE_READY = 0;
export const FIXTURE_PID = 1;
export const FIXTURE_SPAWNS = 2;
export const FIXTURE_EXITS = 3;
export const FIXTURE_EXIT_CODE = 4;
export const FIXTURE_FINISHED = 5;
export const FIXTURE_WORDS = 6;

export interface KeychainFixtureConfiguration {
  type: "fixture-config";
  control: SharedArrayBuffer;
  releasePath: string;
  output: string;
}

type WorkerScope = {
  onmessage: ((event: MessageEvent<KeychainRequest | KeychainFixtureConfiguration>) => void) | null;
  postMessage(value: unknown): void;
};
const scope = globalThis as unknown as WorkerScope;

// The synthetic child waits for an explicit release, so a slow CI host cannot
// accidentally turn a deadline/liveness assertion into an already-completed read.
// A natural safety exit bounds leftovers if a test process itself disappears.
const childSource = `
  const { existsSync } = await import("node:fs");
  const deadline = performance.now() + 2_000;
  while (!existsSync(process.argv[1])) {
    if (performance.now() >= deadline) process.exit(2);
    await Bun.sleep(5);
  }
  process.stdout.write(process.argv[2]);
`;

if (!Bun.isMainThread && typeof scope.postMessage === "function") {
  let configuration: KeychainFixtureConfiguration | undefined;
  scope.onmessage = async ({ data }) => {
    if ("type" in data) {
      configuration = data;
      const control = new Int32Array(data.control);
      Atomics.store(control, FIXTURE_READY, 1);
      Atomics.notify(control, FIXTURE_READY);
      return;
    }
    if (!configuration) throw new Error("Keychain fixture must be configured before reading");
    const config = configuration, control = new Int32Array(config.control);
    const completed = await runKeychainRequest(data, {
      // This override is unconditional. The fixture never invokes security,
      // even when the test runs on a Mac with real credentials in its Keychain.
      spawn: (_argv, options) => {
        const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", "-e", childSource,
          config.releasePath, config.output], options);
        Atomics.add(control, FIXTURE_SPAWNS, 1);
        Atomics.store(control, FIXTURE_PID, child.pid);
        Atomics.notify(control, FIXTURE_PID);
        void child.exited.then(code => {
          Atomics.store(control, FIXTURE_EXIT_CODE, code);
          Atomics.add(control, FIXTURE_EXITS, 1);
          Atomics.notify(control, FIXTURE_EXITS);
        });
        return child;
      },
    });
    if (!completed) return;
    Atomics.add(control, FIXTURE_FINISHED, 1);
    Atomics.notify(control, FIXTURE_FINISHED);
    scope.postMessage(null);
  };
}
