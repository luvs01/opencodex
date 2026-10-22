import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inspectCodexCliInstall, MAX_NATIVE_BACKING_BYTES } from "../../src/codex/cli-install-provenance";
import { createCodexCliUpdatePlan } from "../../src/codex/cli-update-plan";
import { setWindowsInstallationFilesOpenedForTests } from "../../src/codex/windows-installation-files";
import { removeTreeWithRetry } from "../helpers/remove-tree";
import { repoPath, repoRoot } from "../helpers/repo-root";
import { handleCodexCliUpdateCommand } from "../../src/cli/codex-cli-update";
import { initializeNodeLauncherContext, NODE_LAUNCH_CONTEXT_ENV, NODE_LAUNCH_PROOF_PREFIX } from "../../src/cli/launcher-context";

const native = process.platform === "win32" && process.arch === "x64" ? test : test.skip;
const roots: string[] = [];
afterEach(() => {
  initializeNodeLauncherContext(["bun", "cli"], {});
  setWindowsInstallationFilesOpenedForTests();
  for (const root of roots.splice(0)) removeTreeWithRetry(root);
});
// npm's independent cmd-shim fixture; no candidate is ever executed.
const cmd = ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL',
  'CALL :find_dp0', '', 'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (',
  '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
].join('\r\n');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ocx-windows-plan-")); roots.push(root);
  const prefix = join(root, "npm");
  const packageRoot = join(prefix, "node_modules", "@openai", "codex");
  // Closest Node lookup lane: there is no earlier ancestor package to shadow it.
  const backing = join(packageRoot, "bin", "node_modules", "@openai", "codex-win32-x64");
  const files = new Map<string, string | Buffer>([
    [join(prefix, "codex.cmd"), cmd],
    [join(prefix, "codex.opencodex-real.cmd"), "stale unselected shim backup"],
    [join(packageRoot, "package.json"), JSON.stringify({ name: "@openai/codex", version: "1.2.3", bin: { codex: "bin/codex.js" } })],
    [join(packageRoot, "bin", "codex.js"), 'throw new Error("Codex must never execute");'],
    [join(backing, "package.json"), JSON.stringify({ name: "@openai/codex", version: "1.2.3-win32-x64" })],
    [join(backing, "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"), "synthetic backing bytes"],
    [join(prefix, "node_modules", "npm", "package.json"), JSON.stringify({ name: "npm", version: "11.0.0", bin: { npm: "bin/npm-cli.js" } })],
    [join(prefix, "node_modules", "npm", "bin", "npm-cli.js"), 'throw new Error("npm must never execute");'],
  ]);
  const pe = Buffer.alloc(128); pe.write('MZ'); pe.writeUInt32LE(64, 60); pe.write('PE\0\0', 64); pe.writeUInt16LE(0x8664, 68);
  files.set(join(prefix, "node.exe"), pe);
  for (const [path, value] of files) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); }
  const deps = { env: { CODEX_CLI_PATH: join(prefix, "codex.cmd"), PATH: prefix, PATHEXT: ".EXE;.CMD" },
    configDir: join(root, "absent-home"), selectionAttested: true, arch: "x64" as const, observeInstallContent: true };
  return { root, prefix, packageRoot, backing, files, deps };
}

native("production Windows inspector binds selected npm shim, package, backing and toolchain with no candidate execution", async () => {
  const f = fixture(); const before = [...f.files].map(([path]) => readFileSync(path));
  const report = await inspectCodexCliInstall(f.deps);
  expect(report).toMatchObject({ managed: true, selectionAttested: true, provenance: "npm-global", reason: "managed_npm_global", packageVersion: "1.2.3" });
  expect(report.installContentDigest).toMatch(/^[a-f0-9]{64}$/);
  expect((await inspectCodexCliInstall(f.deps)).installContentDigest).toBe(report.installContentDigest);
  expect(JSON.stringify(report)).not.toContain(f.root);
  expect([...f.files].map(([path]) => readFileSync(path))).toEqual(before);
});

native("a production plan is deterministic while Windows apply stays explicitly disabled", async () => {
  const f = fixture();
  const deps = { inspectionDeps: f.deps, resolveTarget: () => ({ kind: "resolved" as const, version: "1.2.4", integrity: "sha512-" + Buffer.alloc(64, 1).toString("base64") }),
    scanProcesses: () => ({ kind: "observed" as const, processes: [] }) };
  const first = await createCodexCliUpdatePlan(deps);
  expect(first).toMatchObject({ managed: true, applicable: false, refusal: "windows_apply_disabled", installedVersion: "1.2.3", targetVersion: "1.2.4" });
  expect(first.planId).toMatch(/^[a-f0-9]{32}$/);
  expect((await createCodexCliUpdatePlan(deps)).planId).toBe(first.planId);
  writeFileSync(join(f.backing, "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"), "changed backing bytes");
  expect((await createCodexCliUpdatePlan(deps)).planId).not.toBe(first.planId);
});

native("a published-size Windows npm backing binds; one past the shared finite limit refuses", async () => {
  const f = fixture();
  const binary = join(f.backing, "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
  // An NTFS sparse file has the installed 0.153.4-win32-x64 backing's logical
  // size without copying its bytes or allocating a dense 295 MB fixture.
  writeFileSync(binary, "");
  expect(process.env.SystemRoot).toBeDefined();
  const sparse = spawnSync(join(process.env.SystemRoot!, "System32", "fsutil.exe"), ["sparse", "setflag", binary],
    { windowsHide: true, encoding: "utf8", timeout: 5_000 });
  expect(sparse.error).toBeUndefined(); expect(sparse.status).toBe(0);
  truncateSync(binary, 295_408_944);
  const report = await inspectCodexCliInstall(f.deps);
  expect(report.managed).toBe(true); expect(report.installContentDigest).toMatch(/^[a-f0-9]{64}$/);
  truncateSync(binary, MAX_NATIVE_BACKING_BYTES + 1);
  expect((await inspectCodexCliInstall(f.deps)).managed).toBe(false);
}, 30_000);

native("unattested, mismatched selection, app/Store/version-manager and unverified launchers remain unmanaged", async () => {
  const f = fixture();
  for (const deps of [ { ...f.deps, selectionAttested: false }, { ...f.deps, selectedCommand: join(f.root, "other.cmd") },
    ...["WindowsApps", "OpenAI/Codex/bin/app", ".nvm", "standalone"].map(dir => ({ ...f.deps,
      env: { ...f.deps.env, CODEX_CLI_PATH: join(f.root, dir, "codex.exe") } })),
  ]) expect((await inspectCodexCliInstall(deps)).managed).toBe(false);
  writeFileSync(join(f.prefix, "codex.cmd"), cmd + "\r\necho retargeted");
  expect((await inspectCodexCliInstall(f.deps)).managed).toBe(false);
});

native("a junction prefix is refused and prefix retarget attempts fail throughout the coherent observation", async () => {
  const f = fixture(); const alias = join(f.root, "alias"); symlinkSync(f.prefix, alias, "junction");
  expect((await inspectCodexCliInstall({ ...f.deps, env: { ...f.deps.env, CODEX_CLI_PATH: join(alias, "codex.cmd") } })).managed).toBe(false);
  let blocked = 0;
  setWindowsInstallationFilesOpenedForTests(() => { try { renameSync(f.prefix, f.prefix + "-moved"); } catch { blocked++; } });
  expect((await inspectCodexCliInstall(f.deps)).managed).toBe(true);
  expect(blocked).toBeGreaterThan(0);
});

native("a selected override changing during observation refuses the original prefix", async () => {
  const f = fixture();
  setWindowsInstallationFilesOpenedForTests(() => { f.deps.env.CODEX_CLI_PATH = join(f.root, "other", "codex.cmd"); });
  expect((await inspectCodexCliInstall(f.deps)).managed).toBe(false);
});

native("npm toolchain drift after inspection refuses metadata without executing the replacement", async () => {
  const f = fixture(); let queries = 0;
  const plan = await createCodexCliUpdatePlan({ inspectionDeps: f.deps, inspect: async deps => {
    const report = await inspectCodexCliInstall(deps); expect(report.managed).toBe(true);
    writeFileSync(join(f.prefix, "node_modules", "npm", "bin", "npm-cli.js"), "throw new Error('replacement');");
    return report;
  }, resolveTarget: () => { queries++; throw new Error("must not query changed toolchain"); } });
  expect(queries).toBe(0); expect(plan.refusal).toBe("target_unresolved");
});

native("actual CLI handler reaches production inspector and plan from the proof-bound selection", async () => {
  const f = fixture(); const proof = "W".repeat(43);
  initializeNodeLauncherContext(["bun", "cli", `${NODE_LAUNCH_PROOF_PREFIX}${proof}`], {
    [NODE_LAUNCH_CONTEXT_ENV]: JSON.stringify({ version: 1, proof, anthropicEnvSlots: [],
      codexCliInspectionEnv: { codexCliPath: f.deps.env.CODEX_CLI_PATH, path: f.prefix,
        pathExt: ".EXE;.CMD", managerRoots: {}, configDir: f.deps.configDir, arch: "x64" } }),
  });
  let reached = false;
  expect(await handleCodexCliUpdateCommand(["plan", "--json"], { createPlan: async deps => {
    const plan = await createCodexCliUpdatePlan({ ...deps,
      resolveTarget: () => ({ kind: "resolved", version: "1.2.4", integrity: "sha512-" + Buffer.alloc(64, 1).toString("base64") }),
      scanProcesses: () => ({ kind: "observed", processes: [] }),
    });
    expect(plan.managed).toBe(true); expect(plan.planId).toMatch(/^[a-f0-9]{32}$/);
    expect(plan.refusal).toBe("windows_apply_disabled"); reached = true; return plan;
  } })).toBe(0);
  expect(reached).toBe(true);
});

native("published Node CLI uses the production inspector and observed toolchain for read-only metadata", () => {
  const f = fixture(); const node = Bun.which("node"); expect(node).not.toBeNull();
  copyFileSync(node!, join(f.prefix, "node.exe"));
  const integrity = "sha512-" + Buffer.alloc(64, 1).toString("base64");
  const main = { name: "@openai/codex", version: "1.2.4", optionalDependencies: { "@openai/codex-win32-x64": "1.2.4" },
    dist: { integrity, tarball: "https://registry.npmjs.org/@openai/codex/-/codex-1.2.4.tgz" } };
  const backing = { name: "@openai/codex-win32-x64", version: "1.2.4", dist: { integrity,
    tarball: "https://registry.npmjs.org/@openai/codex-win32-x64/-/codex-win32-x64-1.2.4.tgz" } };
  // Controlled registry protocol fixture; no real npm installation or network request.
  writeFileSync(join(f.prefix, "node_modules", "npm", "bin", "npm-cli.js"),
    `const spec = process.argv[3]; console.log(JSON.stringify(spec.startsWith('@openai/codex-win32-x64@') ? ${JSON.stringify(backing)} : ${JSON.stringify(main)}));`);
  const run = spawnSync(node!, [repoPath("bin", "ocx.mjs"), "system", "codex-cli-update", "plan", "--json"], {
    cwd: repoRoot(), encoding: "utf8", windowsHide: true, timeout: 45_000,
    env: { ...process.env, CODEX_CLI_PATH: f.deps.env.CODEX_CLI_PATH, OPENCODEX_HOME: f.deps.configDir,
      OPENCODEX_BUN_PATH: process.execPath, OCX_NO_DESKTOP_HANDOFF: "1" },
  });
  expect(run.error).toBeUndefined(); expect(run.status).toBe(0);
  const plan = JSON.parse(run.stdout);
  expect(plan.managed).toBe(true); expect(plan.targetVersion).toBe("1.2.4");
  expect(plan.targetIntegrity).toBe(integrity);
  expect(plan.applicable).toBe(false);
  expect(["blocked_active_session", "blocked_process_state_unknown", "windows_apply_disabled"]).toContain(plan.refusal);
  expect(JSON.stringify(plan)).not.toContain(f.root);
}, 60_000);
