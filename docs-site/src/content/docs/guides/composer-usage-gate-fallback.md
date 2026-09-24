---
title: Composer Usage-Gate Fallback
description: Queue text to an existing Codex thread without changing desktop authentication, while preserving server-side quotas and making delivery limits explicit.
---

A desktop **composer-only** usage gate can prevent new input even when a thread's configured
OpenCodex route has available capacity. On a compatible installation, `codex queue` is a
low-impact fallback: it submits through Codex's native app-server queue without using that input
box. It does not patch the app, intercept TLS, install a certificate, or change authentication.

This is **not a fix for every usage-limit state**. It neither restores exhausted quota nor
unlocks the model picker. A thread already using `gpt-reserve` keeps that model; queueing text
does not switch it to another provider. Server-side authorization, provider quotas, approvals,
and the thread's execution settings still apply.

## Check the target and compatibility first

Use the **same `CODEX_HOME` and a compatible CLI/app-server** as the target desktop installation.
`CODEX_HOME` defaults to `~/.codex`; a different home can discover a different daemon and thread
store. Do not change it just to bypass an error. Prefer the app-bundled CLI; a separately installed
`codex` on PATH may be older. Check `codex queue --help` for `--thread` and `--message`.

The helpers below probe this CLI capability, but only the actual request can verify the daemon's
`thread/queue/add` support. If Codex reports an unsupported queue method, save ongoing work before
updating/restarting the matching installation. The helpers do not restart a daemon, change
settings, or retry with another server. Do not add `--no-daemon` to a queue command.

## Sending to an existing thread

First open the intended conversation in the desktop app and confirm its project, model and
provider. Prefer its **explicit UUID**; the native CLI also accepts an exact session name:

```powershell
codex queue --thread 'my-project-review' --message 'continue with the next step'
```

From a repository checkout, the Windows helper can discover the bundled native `codex.exe`:

```powershell
.\scripts\codex-queue.ps1 -Thread 'my-project-review' -Message 'continue with the next step'
```

On macOS/Linux, use Bash (including macOS's Bash 3.2):

```bash
bash scripts/codex-queue.sh --thread 'my-project-review' --message 'continue with the next step'
```

To pin the matching trusted binary, pass `-CodexExe 'C:\path\to\codex.exe'` or
`--codex '/path/to/codex'`. Both helpers also accept `CODEX_EXE` as a path override.
An invalid explicit selection fails instead of silently picking another executable. On Windows,
use a native `.exe`, not an npm `.cmd` or PowerShell shim; this keeps message quoting out of
`cmd.exe`. Bundled and standalone package layouts are tried before PATH, and a candidate that
lacks the queue flags is skipped. Discovery is best-effort, not proof of a matching app version.

### Optional latest-thread discovery

Neither helper silently selects a thread when the target is omitted. For legacy rollout-based
stores, inspect an explicit **latest-file heuristic** with:

```powershell
.\scripts\codex-queue.ps1 -Latest -DryRun
```

```bash
bash scripts/codex-queue.sh --latest --dry-run
```

This searches `CODEX_HOME/sessions` (or `~/.codex/sessions` by default) by modification time;
filename order breaks equal-time ties. It is **not the current desktop conversation** and can
select a different project or a subagent. Verify the preview, then use `-Thread` / `--thread`
with the chosen UUID. `-Latest` / `--latest` can also send when a message is provided, but that
remains an explicit opt-in to this heuristic.

Recognized `rollout-*.jsonl` filenames contain a thread UUID, sometimes followed by
`_<rollout-uuid>`; the helper uses the first UUID. Malformed names are skipped, and missing or
unreadable stores fail rather than falling back to another home. Migrated/paginated-only stores
and remote-only conversations may have no matching local rollout: use the explicit UUID/name
instead. `-DryRun` / `--dry-run` only probes CLI help and prints the chosen executable and target;
it never queues or prints the message body.

Keep the entire message in one argument. Bash accepts `--message '- start with this'` or
`-- '- start with this'`; PowerShell accepts `-Message '- start with this'`. Shell history and
local process listings can expose command-line text, so do not include credentials in prompts.

## Queued is not the same as executed

`Queued message ... for thread ...` confirms **queue acceptance**, not model execution or
completion. A busy thread may wait for its current turn or approval. In the inspected upstream
implementation, an unloaded saved thread can retain the message without dispatching it until
another client resumes that thread.

Check the queue and activity in the **same conversation**. If it is not loaded, open it in the
app or use `codex resume <thread-id>` without adding the prompt again. Review pending approvals
and the thread's queue state. Do not repeatedly re-send a message just because no response has
appeared: each queue invocation can create another queued item. The helpers propagate the CLI
exit status and never retry automatically; after an ambiguous failure, inspect before retrying.

The helpers target local discovery; they do not identify a conversation on another machine from
local filenames. The native CLI has explicit `--remote` options (see `codex queue --help`), but
that is distinct from assuming the desktop's remote-control connection is automatically reused.
This workaround leaves desktop authentication configuration alone; it does not guarantee that an
unrelated authentication/network fault or unsupported server will be repaired.

## Starting or resuming work without the composer

`codex exec '<prompt>'` starts a non-interactive task; it is **not** delivery into the currently
open desktop thread. Check its working directory, provider, permissions and configuration.
`codex resume <thread-id>` resumes an explicit existing session. `codex resume --last` normally
filters selection by the current working directory; `--all` disables that filter, while other
session eligibility filters can still apply. A global selection is not necessarily the visible
or newest filesystem session. Prefer an explicit ID for ongoing desktop work.

## Scope and verification

This fallback is preferable to changing feature-gate responses or authentication solely to get
text into an otherwise usable thread: it changes neither account entitlement nor app files.
It is a workaround, not a provider-aware repair of the desktop composer/model picker. App/CLI
updates can still change compatibility. When the composer becomes usable, no helper-specific
configuration needs reverting; these scripts do not undo unrelated earlier proxy/certificate
changes.

The original Windows probe (desktop `26.917.9434.0`) reported queue acceptance for a live thread
and an expected error for a nonexistent thread. That is not a general end-to-end inference,
unloaded-thread, remote-control or cross-platform guarantee. The current upstream source was
also checked at commit `7dae8c53d97e61cd774e4d6bcca5243c29ca615c`:

- [CLI queue options](https://github.com/openai/codex/blob/7dae8c53d97e61cd774e4d6bcca5243c29ca615c/codex-rs/cli/src/queue_cmd.rs)
  and [app-server submission](https://github.com/openai/codex/blob/7dae8c53d97e61cd774e4d6bcca5243c29ca615c/codex-rs/tui/src/session_queue_commands.rs).
- [Loaded-thread queue dispatch](https://github.com/openai/codex/blob/7dae8c53d97e61cd774e4d6bcca5243c29ca615c/codex-rs/ext/queue/src/service.rs)
  and [resume selection options](https://github.com/openai/codex/blob/7dae8c53d97e61cd774e4d6bcca5243c29ca615c/codex-rs/cli/src/main.rs).

Maintainers can run the offline wrapper regressions with
`node --test scripts/codex-queue.test.mjs` (Node 20+). They use a fake native CLI and temporary
homes, never a real account or model. Windows runs Windows PowerShell and, when installed, pwsh;
POSIX runs Bash and, when installed, pwsh. These tests do not establish live queue dispatch or
Desktop compatibility; validate those separately on the supported installations.
