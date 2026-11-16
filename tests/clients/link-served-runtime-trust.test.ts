import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { remoteOcxArgv, remotePinnedSyncArgv } from "../../src/link/ssh-argv";
import { remoteFullInstallCensusArgv, remoteInspectRuntimeArgv } from "../../src/link/remote-plant";
import { spawnTestChild } from "../helpers/spawn-test-child";
import { SPAWN_BUDGET_MS } from "../helpers/test-budget";

const posix = test.skipIf(process.platform === "win32");
const roots: string[] = [];
const active = new Set<string>();
afterEach(() => { for (const root of roots.splice(0)) if (!active.has(root)) rmSync(root, { recursive: true, force: true }); });
const q = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

function executable(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

function fixture(platform = "Linux") {
  const home = mkdtempSync(join(tmpdir(), "ocx-runtime-trust-")); roots.push(home);
  const bin = join(home, "tools"); mkdirSync(bin);
  for (const name of ["sh", "mktemp", "sleep", "cat", "awk", "dd", "wc", "rm", "stat", "id", "readlink"]) {
    const command = Bun.which(name);
    if (!command) throw new Error(`Missing fixture tool: ${name}`);
    symlinkSync(command, join(bin, name));
  }
  // Exercise the Linux gate on either POSIX host; Darwin fallback has separate cases.
  executable(join(bin, "uname"), `printf '%s\\n' ${q(platform)}`);
  const served = join(home, "package/bun");
  const entry = join(home, "package/src/cli/index.ts");
  mkdirSync(dirname(entry), { recursive: true }); writeFileSync(entry, "// fixture entry\n");
  executable(served, `printf '%s\\n' "$*" >> "$HOME/served-calls"
for arg do if [ "$arg" = --version ]; then printf 'opencodex 2.99.0\\n'; exit 0; fi; done
printf 'served\\n'`);
  executable(join(home, ".opencodex-desktop/bin/ocx"), `if [ "$1" = --version ]; then printf 'opencodex 2.98.0\\n'; exit 0; fi
printf 'fallback\\n'`);
  const config = join(home, ".opencodex"); mkdirSync(config);
  const record = (command: string[]) => writeFileSync(join(config, "serving-runtimes.json"), JSON.stringify({ runtimes: [{ command }] }, null, 2) + "\n");
  record([served, entry]);
  const run = async (argv: string[]) => {
    const isolated = [...argv];
    isolated[2] = isolated[2]!
      .replace('export PATH="$PATH:$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin"', 'export PATH="$PATH"')
      .replaceAll('"/Applications/OpenCodex.app/Contents/MacOS/ocx"', '"$HOME/missing-app"')
      .replaceAll('"/usr/bin/ocx"', '"$HOME/missing-system"');
    active.add(home);
    const result = await spawnTestChild(isolated, { cwd: home, deadlineMs: 10_000, env: { HOME: home, OPENCODEX_HOME: config, PATH: bin, TMPDIR: home } });
    if (result.reaped && result.pipesClosed) active.delete(home);
    expect(result.timedOut).toBe(false); expect(result.reaped).toBe(true); expect(result.pipesClosed).toBe(true);
    expect(result.exitCode).toBe(0);
    return result;
  };
  return { home, bin, served, entry, record, run };
}

const consumers = [
  ["discovery", () => remoteOcxArgv(["link", "port"])],
  ["pinned sync", () => remotePinnedSyncArgv("lnk_0123456789abcdef")],
  ["inspection", () => remoteInspectRuntimeArgv()],
  ["full-install census", () => remoteFullInstallCensusArgv()],
] as const;

for (const [name, argv] of consumers) {
  posix(`${name} refuses a writable recorded binary before its version probe`, async () => {
    const f = fixture(); chmodSync(f.served, 0o777);
    const result = await f.run(argv());
    expect(existsSync(join(f.home, "served-calls"))).toBe(false);
    expect(result.stderr).not.toContain("not found");
  }, SPAWN_BUDGET_MS);
  posix(`${name} refuses a writable recorded entrypoint before starting its interpreter`, async () => {
    const f = fixture(); chmodSync(f.entry, 0o666);
    await f.run(argv());
    expect(existsSync(join(f.home, "served-calls"))).toBe(false);
  }, SPAWN_BUDGET_MS);
}

posix.each(["binary", "entry"] as const)("a foreign-owned recorded %s is not executed", async target => {
  const f = fixture();
  const foreign = process.getuid?.() === 0 ? 65534 : 0;
  const path = target === "binary" ? f.served : f.entry;
  const realStat = Bun.which("stat")!;
  unlinkSync(join(f.bin, "stat"));
  executable(join(f.bin, "stat"), `for last do :; done
if [ "$last" = ${q(path)} ]; then printf '${foreign} 755\\n'; else exec ${q(realStat)} "$@"; fi`);
  await f.run(remoteOcxArgv(["link", "port"]));
  expect(existsSync(join(f.home, "served-calls"))).toBe(false);
}, SPAWN_BUDGET_MS);

posix.each(["binary", "entry"] as const)("a replaceable ancestor of the recorded %s is refused", async target => {
  const f = fixture();
  // The entry's immediate parent differs from the interpreter's parent.
  chmodSync(target === "binary" ? dirname(f.served) : dirname(f.entry), 0o777);
  await f.run(remoteOcxArgv(["link", "port"]));
  expect(existsSync(join(f.home, "served-calls"))).toBe(false);
}, SPAWN_BUDGET_MS);

posix("trusted sticky ancestors and owned symlinked package paths remain usable", async () => {
  const f = fixture();
  chmodSync(dirname(f.served), 0o1777);
  const linked = join(f.home, "current-package"); symlinkSync("package", linked);
  f.record([join(linked, "bun"), join(linked, "src/cli/index.ts")]);
  const result = await f.run(remoteOcxArgv(["link", "port"]));
  expect(result.stdout).toBe("served\n");
  expect(readFileSync(join(f.home, "served-calls"), "utf8")).toContain(join(linked, "src/cli/index.ts"));
}, SPAWN_BUDGET_MS);

posix("symlink destinations cannot conceal a replaceable ancestor", async () => {
  const f = fixture();
  const linked = join(f.home, "current-package"); symlinkSync("package", linked);
  f.record([join(linked, "bun"), join(linked, "src/cli/index.ts")]);
  chmodSync(dirname(f.served), 0o777);
  await f.run(remoteOcxArgv(["link", "port"]));
  expect(existsSync(join(f.home, "served-calls"))).toBe(false);
}, SPAWN_BUDGET_MS);

posix("a symlink loop is skipped within the bounded resolver", async () => {
  const f = fixture();
  symlinkSync("loop", join(f.home, "loop")); f.record([join(f.home, "loop")]);
  expect((await f.run(remoteOcxArgv(["link", "port"]))).stdout).toBe("fallback\n");
  expect(existsSync(join(f.home, "served-calls"))).toBe(false);
}, SPAWN_BUDGET_MS);

posix("a trailing newline in a symlink target cannot substitute the checked path", async () => {
  const f = fixture();
  const newlineTarget = f.served + "\n";
  executable(newlineTarget, 'printf "unexpected\\n" >> "$HOME/served-calls"; printf "opencodex 2.99.0\\n"');
  chmodSync(newlineTarget, 0o777);
  symlinkSync("package/bun\n", join(f.home, "linked-bun"));
  f.record([join(f.home, "linked-bun")]);
  const result = await f.run(remoteOcxArgv(["link", "port"]));
  expect(result.stdout).toBe("fallback\n");
  expect(existsSync(join(f.home, "served-calls"))).toBe(false);
}, SPAWN_BUDGET_MS);

posix.each(["stat", "id"])("missing %s skips the recorded install without running it", async tool => {
  const f = fixture(); unlinkSync(join(f.bin, tool));
  const result = await f.run(remoteOcxArgv(["link", "port"]));
  expect(result.stdout).toBe("fallback\n"); expect(result.stderr).toBe("");
  expect(existsSync(join(f.home, "served-calls"))).toBe(false);
}, SPAWN_BUDGET_MS);

posix("a missing symlink reader never treats the link as a regular executable", async () => {
  const f = fixture(); unlinkSync(join(f.bin, "readlink"));
  symlinkSync("package/bun", join(f.home, "linked-bun"));
  f.record([join(f.home, "linked-bun"), f.entry]);
  const result = await f.run(remoteOcxArgv(["link", "port"]));
  expect(result.stdout).toBe("fallback\n"); expect(result.stderr).toBe("");
  expect(existsSync(join(f.home, "served-calls"))).toBe(false);
}, SPAWN_BUDGET_MS);

posix("BSD stat output uses the same gate when GNU formatting is unavailable", async () => {
  const f = fixture(); const realStat = Bun.which("stat")!;
  unlinkSync(join(f.bin, "stat"));
  executable(join(f.bin, "stat"), `if [ "$1" = -c ]; then exit 1; fi
[ "$1" = -f ] && [ "$2" = '%u %Lp' ] || exit 1
shift 2
exec ${q(realStat)} ${process.platform === "darwin" ? "-f '%u %Lp'" : "-c '%u %a'"} "$@"`);
  expect((await f.run(remoteOcxArgv(["link", "port"]))).stdout).toBe("served\n");
}, SPAWN_BUDGET_MS);

for (const [name, argv] of consumers) {
  posix.each(["binary", "package"] as const)(`Darwin ${name} skips recorded %s hints before any version probe`, async kind => {
    const f = fixture("Darwin");
    if (kind === "binary") f.record([f.served]);
    const result = await f.run(argv());
    expect(existsSync(join(f.home, "served-calls"))).toBe(false);
    if (name === "discovery") expect(result.stdout).toBe("fallback\n");
    if (name === "pinned sync") expect(result.stderr).toContain("ocx-fanout:selected:2.98.0");
    if (name === "inspection") expect(result.stdout).toContain("ocx-inspect:version:opencodex 2.98.0");
    if (name === "full-install census") expect(result.stdout).toContain("ocx-census:full");
  }, SPAWN_BUDGET_MS);
}

posix.each(["FreeBSD", ""])("an unverified platform %s skips recorded hints", async platform => {
  const f = fixture(platform);
  expect((await f.run(remoteOcxArgv(["link", "port"]))).stdout).toBe("fallback\n");
  expect(existsSync(join(f.home, "served-calls"))).toBe(false);
}, SPAWN_BUDGET_MS);
