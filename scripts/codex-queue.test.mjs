// Standalone, offline regression tests: node --test scripts/codex-queue.test.mjs
// No real Codex process, credentials, daemon, or model requests are used.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scripts = dirname(fileURLToPath(import.meta.url));
const windows = process.platform === 'win32';
const roots = [];
after(() => roots.forEach(root => rmSync(root, { recursive: true, force: true })));
const threadA = '00000000-0000-4000-8000-000000000001';
const threadB = '00000000-0000-4000-8000-000000000002';
const rolloutId = '00000000-0000-4000-8000-000000000099';
function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'ocx queue test '));
  roots.push(root);
  return root;
}

// The fake native CLI logs base64 fields, avoiding an additional JSON library
// on Windows. Help probes and submissions use separate fixture-only logs.
const stubJs = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === 'queue' && args[1] === '--help') {
  fs.appendFileSync(process.env.STUB_PROBE_LOG, Buffer.from(process.argv[1]).toString('base64') + '\\n');
  console.log(path.basename(process.argv[1]).startsWith('old') ? 'old CLI help' : 'queue --thread THREAD --message TEXT');
  process.exit(process.env.STUB_HELP_FAIL ? 1 : 0);
}
const fields = [process.env.CODEX_HOME || '', process.argv[1], process.cwd(), process.env.OPENCODEX_HOME || '', ...args];
fs.appendFileSync(process.env.STUB_LOG, fields.map(s => Buffer.from(s).toString('base64')).join('|') + '\\n');
process.exit(Number(process.env.STUB_EXIT || 0));
`;
const stubCs = `using System;
using System.IO;
using System.Linq;
using System.Text;
class QueueStub {
  static int Main(string[] args) {
    string exe = Environment.GetCommandLineArgs()[0];
    if (args.Length == 2 && args[0] == "queue" && args[1] == "--help") {
      File.AppendAllText(Environment.GetEnvironmentVariable("STUB_PROBE_LOG"), Convert.ToBase64String(Encoding.UTF8.GetBytes(exe)) + "\\n");
      Console.WriteLine(Path.GetFileName(exe).StartsWith("old") ? "old CLI help" : "queue --thread THREAD --message TEXT");
      return Environment.GetEnvironmentVariable("STUB_HELP_FAIL") == null ? 0 : 1;
    }
    string[] fields = new string[] { Environment.GetEnvironmentVariable("CODEX_HOME") ?? "", exe, Environment.CurrentDirectory, Environment.GetEnvironmentVariable("OPENCODEX_HOME") ?? "" }.Concat(args).ToArray();
    File.AppendAllText(Environment.GetEnvironmentVariable("STUB_LOG"), String.Join("|", fields.Select(s => Convert.ToBase64String(Encoding.UTF8.GetBytes(s)))) + "\\n");
    return Int32.Parse(Environment.GetEnvironmentVariable("STUB_EXIT") ?? "0");
  }
}`;
let nativeStub;
if (windows) {
  const build = scratch();
  const compiler = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe');
  nativeStub = join(build, 'queue-stub.exe');
  const source = join(build, 'QueueStub.cs');
  writeFileSync(source, stubCs);
  assert.ok(existsSync(compiler), 'Windows tests require the built-in .NET Framework C# compiler');
  const result = spawnSync(compiler, ['/nologo', '/target:exe', `/out:${nativeStub}`, source], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
}
function makeStub(path) {
  mkdirSync(dirname(path), { recursive: true });
  if (windows) copyFileSync(nativeStub, path);
  else { writeFileSync(path, stubJs); chmodSync(path, 0o755); }
  return path;
}
function fixture() {
  const root = scratch();
  const home = join(root, 'home with spaces');
  const store = join(root, 'configured [store]');
  mkdirSync(home); mkdirSync(store);
  const exe = makeStub(join(root, 'bin with spaces', windows ? 'codex.exe' : 'codex'));
  const log = join(root, 'submissions.log');
  const probeLog = join(root, 'probes.log');
  const ocxHome = join(root, 'opencodex home'); mkdirSync(ocxHome);
  const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: store,
    LOCALAPPDATA: join(root, 'local app data'), STUB_LOG: log, STUB_PROBE_LOG: probeLog, OPENCODEX_HOME: ocxHome,
    PATH: dirname(process.execPath) + (windows ? ';' : ':') + process.env.PATH };
  delete env.CODEX_EXE; delete env.STUB_HELP_FAIL; delete env.STUB_EXIT;
  return { root, home, store, exe, log, probeLog, ocxHome, env };
}
function rollout(store, id, timestamp, suffix = '', subdir = '2026/01/01') {
  const path = join(store, 'sessions', subdir, `rollout-2026-01-01T00-00-00-${id}${suffix}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '{}\n');
  utimesSync(path, timestamp, timestamp);
  return path;
}
function records(f) {
  if (!existsSync(f.log)) return [];
  return readFileSync(f.log, 'utf8').trim().split('\n').map(line => {
    const [home, exe, cwd, ocxHome, ...args] = line.split('|').map(field => Buffer.from(field, 'base64').toString());
    return { home, exe, cwd, ocxHome, args };
  });
}
function probes(f) {
  return existsSync(f.probeLog)
    ? readFileSync(f.probeLog, 'utf8').trim().split('\n').map(s => Buffer.from(s, 'base64').toString()) : [];
}
const requiredShells = (process.env.CODEX_QUEUE_TEST_SHELLS || '').split(',').filter(Boolean);
const shells = requiredShells.length ? requiredShells : windows
  ? ['powershell.exe', 'pwsh.exe']
  : ['bash', ...(spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0 ? ['pwsh'] : [])];
for (const shell of shells) {
  const ps = !basename(shell).startsWith('bash');
  const available = spawnSync(shell, ps ? ['-NoProfile', '-Command', 'exit 0'] : ['--version']).status === 0;
  if (requiredShells.length) assert.ok(available, `Required shell is unavailable: ${shell}`);
  describe(`${shell} native queue helper`, { skip: !available }, () => {
    function run(f, options = {}) {
      const args = [join(scripts, ps ? 'codex-queue.ps1' : 'codex-queue.sh')];
      const flagPositions = new Set();
      const flag = (name, value) => { flagPositions.add(args.length); args.push(ps ? '-' + name : '--' + ({ CodexExe: 'codex', DryRun: 'dry-run', ShowTarget: 'show-target' }[name] || name.toLowerCase())); if (value !== undefined) args.push(value); };
      if (options.pin !== false) flag('CodexExe', options.exe || f.exe);
      if (options.thread !== undefined) flag('Thread', options.thread);
      if (options.latest) flag('Latest');
      if (options.dryRun) flag('DryRun');
      if (options.showTarget) flag('ShowTarget');
      if (options.message !== undefined) flag('Message', options.message);
      if (options.extra) args.push(...options.extra);
      // Enter through PowerShell literals, not -File's external string binder.
      // This isolates the helper's native argv handling, even for leading dashes.
      const psLiteral = value => "'" + value.replaceAll("'", "''") + "'";
      const command = (options.location ? 'Set-Location -LiteralPath ' + psLiteral(options.location) + '; ' : '') + '& ' + args.map((arg, index) =>
        flagPositions.has(index)
          ? arg : psLiteral(arg)).join(' ');
      const launchArgs = ps
        ? ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')]
        : args;
      const result = spawnSync(shell, launchArgs, { env: { ...f.env, ...options.env }, cwd: f.root, encoding: 'utf8', timeout: 30000 });
      assert.equal(result.error, undefined, result.error?.message);
      return { ...result, output: result.stdout + result.stderr };
    }
    it('requires a deliberate target without submitting', () => {
      const f = fixture(); rollout(f.store, threadA, 100);
      assert.notEqual(run(f, { message: 'do not send' }).status, 0);
      assert.deepEqual(records(f), []);
    });
    it('refuses mutually exclusive targets', () => {
      const f = fixture();
      assert.notEqual(run(f, { thread: threadA, latest: true, message: 'do not send' }).status, 0);
      assert.deepEqual(records(f), []);
    });
    it('accepts an explicit thread without a local rollout scan', () => {
      const f = fixture();
      assert.equal(run(f, { thread: threadA, message: 'continue' }).status, 0);
      assert.deepEqual(records(f)[0].args, ['queue', `--thread=${threadA}`, '--message=continue']);
    });
    it('passes an exact name unchanged, including spaces and a leading dash', () => {
      const f = fixture(); const name = '-my exact project name';
      assert.equal(run(f, { thread: name, message: 'continue' }).status, 0);
      assert.equal(records(f)[0].args[1], `--thread=${name}`);
    });
    it('preserves quotes, Unicode, multiline text, metacharacters and trailing backslashes', () => {
      const f = fixture(); const message = '- "한글"\n$(do-not-execute) & | ; %PATH% `quote` \\path\\';
      assert.equal(run(f, { thread: threadA, message }).status, 0);
      assert.equal(records(f)[0].args[2], `--message=${message}`);
    });
    it('keeps an option-looking message as text', () => {
      const f = fixture(); const message = '-Thread';
      assert.equal(run(f, { thread: threadA, message }).status, 0);
      assert.equal(records(f)[0].args[2], `--message=${message}`);
    });
    it('rejects empty messages without submitting', () => {
      const f = fixture();
      assert.notEqual(run(f, { thread: threadA, message: '' }).status, 0);
      assert.deepEqual(records(f), []);
    });
    it('dry run can omit a message and never submits', () => {
      const f = fixture(); const result = run(f, { thread: threadA, dryRun: true });
      assert.equal(result.status, 0, result.output); assert.ok(!result.output.includes(threadA));
      assert.ok(!result.output.includes(f.exe)); assert.ok(!result.output.includes(f.store));
      assert.deepEqual(records(f), []);
    });
    it('does not disclose discovered targets or message bodies during a dry run', () => {
      const f = fixture(); rollout(f.store, threadA, 100);
      const result = run(f, { latest: true, dryRun: true, message: 'private fixture prompt' });
      assert.equal(result.status, 0, result.output);
      for (const value of [threadA, f.exe, f.store, f.home, 'private fixture prompt']) {
        assert.ok(!result.output.includes(value), 'Private value leaked from dry run');
      }
      assert.deepEqual(records(f), []);
    });
    it('requires a dry run and local terminal for explicit target disclosure', () => {
      const f = fixture();
      for (const dryRun of [true, false]) {
        const result = run(f, { thread: threadA, message: 'not sent', showTarget: true, dryRun });
        assert.notEqual(result.status, 0); assert.ok(!result.output.includes(threadA));
      }
      assert.deepEqual(probes(f), []); assert.deepEqual(records(f), []);
    });
    it('redacts an exact session name in diagnostics', () => {
      const f = fixture(); const name = 'private customer project';
      const result = run(f, { thread: name, dryRun: true });
      assert.equal(result.status, 0, result.output); assert.ok(!result.output.includes(name));
      assert.deepEqual(records(f), []);
    });
    for (const allowed of [true, false]) {
      for (const provider of ['openai', 'opencodex']) {
        it(`preserves OpenCodex routing/configuration with allowed=${allowed}, provider=${provider}`, () => {
          const f = fixture();
          // These are opaque fixture files, NOT real account credentials or backend probes.
          const inputs = new Map([
            [join(f.store, 'config.toml'), `model_provider = "${provider}"\nopenai_base_url = "http://127.0.0.1:19234/v1"\n`],
            [join(f.store, 'auth.json'), '{"fixture":"unchanged"}\n'],
            [join(f.store, 'usage-fixture.json'), JSON.stringify({ rate_limit: { allowed } })],
            [join(f.ocxHome, 'config.json'), '{"codexDesktopAuthless":false,"fixture":"unchanged"}\n'],
          ]);
          for (const [path, text] of inputs) writeFileSync(path, text);
          for (const dryRun of [true, false]) {
            const result = run(f, { thread: threadA, message: 'continue', dryRun });
            assert.equal(result.status, 0, result.output);
            assert.equal(records(f).length, dryRun ? 0 : 1);
            for (const [path, text] of inputs) assert.equal(readFileSync(path, 'utf8'), text);
          }
          const record = records(f)[0];
          assert.equal(record.home, f.store); assert.equal(record.ocxHome, f.ocxHome);
          assert.equal(realpathSync(record.cwd), realpathSync(f.root));
          assert.deepEqual(record.args, ['queue', `--thread=${threadA}`, '--message=continue']);
          assert.equal(probes(f).length, 2); // Only help probes, no usage/login/sync command.
        });
      }
    }
    if (ps) {
      it('uses the PowerShell location instead of the inherited process cwd', () => {
        const f = fixture(); const location = join(f.root, 'project [other]'); mkdirSync(location);
        const relativeStore = 'local store'; rollout(join(location, relativeStore), threadA, 100);
        const result = run(f, { latest: true, message: 'continue', location, env: { CODEX_HOME: relativeStore } });
        assert.equal(result.status, 0, result.output);
        assert.equal(records(f)[0].home, relativeStore);
        assert.equal(realpathSync(records(f)[0].cwd), realpathSync(location));
        assert.equal(records(f)[0].args[1], `--thread=${threadA}`);
      });
    }
    it('uses CODEX_HOME rather than a newer unrelated default-home session', () => {
      const f = fixture(); rollout(f.store, threadA, 100); rollout(join(f.home, '.codex'), threadB, 200);
      const result = run(f, { latest: true, message: 'continue' });
      assert.equal(result.status, 0, result.output);
      assert.equal(records(f)[0].args[1], `--thread=${threadA}`); assert.equal(records(f)[0].home, f.store);
    });
    it('does not fall back to default-home sessions when the effective store is empty', () => {
      const f = fixture(); rollout(join(f.home, '.codex'), threadB, 100);
      assert.notEqual(run(f, { latest: true, message: 'do not send' }).status, 0);
      assert.deepEqual(records(f), []);
    });
    it('extracts the first UUID from two-UUID rollout names', () => {
      const f = fixture(); rollout(f.store, threadA, 100, '_' + rolloutId);
      assert.equal(run(f, { latest: true, message: 'continue' }).status, 0);
      assert.equal(records(f)[0].args[1], `--thread=${threadA}`);
    });
    it('skips malformed newest filenames instead of masking a valid session', () => {
      const f = fixture(); rollout(f.store, threadA, 100); rollout(f.store, 'not-a-thread', 200);
      assert.equal(run(f, { latest: true, message: 'continue' }).status, 0);
      assert.equal(records(f)[0].args[1], `--thread=${threadA}`);
    });
    it('handles a large tree and selects the globally newest file', () => {
      const f = fixture();
      for (let i = 0; i < 2200; i++) rollout(f.store, threadA, 100, '', `many/${String(i).padStart(5, '0')}`);
      rollout(f.store, threadB, 200, '', 'last');
      const result = run(f, { latest: true, message: 'continue' });
      assert.equal(result.status, 0, result.output); assert.equal(records(f)[0].args[1], `--thread=${threadB}`);
    });
    it('propagates a queue failure once, without retrying', () => {
      const f = fixture();
      assert.equal(run(f, { thread: threadA, message: 'continue', env: { STUB_EXIT: '23' } }).status, 23);
      assert.equal(records(f).length, 1);
    });
    it('fails closed when pinned CLI only prints generic help', () => {
      const f = fixture(); const old = makeStub(join(f.root, windows ? 'old.exe' : 'old'));
      assert.notEqual(run(f, { exe: old, thread: threadA, message: 'do not send' }).status, 0);
      assert.deepEqual(records(f), []);
    });
    it('fails closed when pinned CLI help fails', () => {
      const f = fixture();
      assert.notEqual(run(f, { thread: threadA, message: 'do not send', env: { STUB_HELP_FAIL: '1' } }).status, 0);
      assert.deepEqual(records(f), []);
    });
    it('does not silently replace a missing pinned executable', () => {
      const f = fixture();
      assert.notEqual(run(f, { exe: join(f.root, 'missing'), thread: threadA, message: 'do not send' }).status, 0);
      assert.deepEqual(records(f), []);
    });
    it('accepts an explicit relative executable path without a PATH lookup', () => {
      const f = fixture(); const name = windows ? 'relative.exe' : 'relative'; makeStub(join(f.root, name));
      assert.equal(run(f, { exe: name, thread: threadA, message: 'continue' }).status, 0);
      assert.equal(records(f).length, 1);
    });
    if (windows) {
      it('rejects command shims before starting them', () => {
        const f = fixture(); const shim = join(f.root, 'codex.cmd');
        writeFileSync(shim, '@echo off\r\nexit /b 0\r\n');
        assert.notEqual(run(f, { exe: shim, thread: threadA, message: 'do not send' }).status, 0);
        assert.deepEqual(records(f), []);
      });
      it('discovers the Windows app bundle before standalone/PATH (dry run only)', () => {
        const f = fixture();
        const bundled = makeStub(join(f.env.LOCALAPPDATA, 'OpenAI/Codex/bin/build-a/codex.exe'));
        const result = run(f, { pin: false, thread: threadA, dryRun: true });
        assert.equal(result.status, 0, result.output); assert.equal(probes(f).at(-1), bundled);
        assert.deepEqual(records(f), []);
      });
    }
    if (!ps) {
      it('supports -- before dash-prefixed positional text', () => {
        const f = fixture(); const message = '- quoted "message"';
        assert.equal(run(f, { thread: threadA, extra: ['--', message] }).status, 0);
        assert.equal(records(f)[0].args[2], `--message=${message}`);
      });
      it('rejects duplicate messages and missing option values', () => {
        const f = fixture();
        for (const extra of [['--message'], ['--thread='], ['--message=a', '--message=b']]) {
          assert.notEqual(run(f, { thread: threadA, extra }).status, 0);
        }
        assert.deepEqual(records(f), []);
      });
      it('handles newline characters in a session directory name', () => {
        const f = fixture(); rollout(f.store, threadA, 100, '', 'folder\nwith newline');
        assert.equal(run(f, { latest: true, message: 'continue' }).status, 0);
        assert.equal(records(f)[0].args[1], `--thread=${threadA}`);
      });
      it('uses default HOME only when CODEX_HOME is unset or empty', () => {
        const f = fixture(); rollout(join(f.home, '.codex'), threadA, 100);
        assert.equal(run(f, { latest: true, message: 'continue', env: { CODEX_HOME: '' } }).status, 0);
        assert.equal(records(f)[0].args[1], `--thread=${threadA}`);
      });
      it('prefers a bundled CLI to an old PATH CLI (discovery only)', () => {
        const f = fixture();
        const bundled = makeStub(join(f.home, 'Applications/Codex.app/Contents/Resources/codex'));
        const old = makeStub(join(f.root, 'old-path/codex'));
        const result = run(f, { pin: false, thread: threadA, dryRun: true, env: { PATH: dirname(old) + ':' + f.env.PATH } });
        assert.equal(result.status, 0, result.output); assert.equal(probes(f).at(-1), bundled);
        assert.deepEqual(records(f), []);
      });
      it('finds the standalone bin layout (discovery only)', { skip: existsSync('/Applications/Codex.app/Contents/Resources/codex') }, () => {
        const f = fixture(); const standalone = makeStub(join(f.store, 'packages/standalone/current/bin/codex'));
        const result = run(f, { pin: false, thread: threadA, dryRun: true });
        assert.equal(result.status, 0, result.output); assert.equal(probes(f).at(-1), standalone);
        assert.deepEqual(records(f), []);
      });
    }
  });
}

// A sidebar contract is not a substitute for the Astro build, but prevents an orphan page.
it('exposes the fallback guide through the explicit site navigation', () => {
  const config = readFileSync(join(scripts, '../docs-site/astro.config.mjs'), 'utf8');
  assert.match(config, /slug: "guides\/composer-usage-gate-fallback"/);
});
