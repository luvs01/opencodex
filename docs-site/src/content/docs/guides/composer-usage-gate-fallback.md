---
title: Composer Usage-Gate Fallback
description: How to keep sending messages when the desktop app's composer is disabled by the client-side usage gate, using only Codex's native CLI paths.
---

When a ChatGPT account reaches its usage limit, the Codex desktop app disables the composer input
field through a client-side gate. The rest of the app keeps working: existing threads still run,
approvals still arrive, remote control still works, and queued follow-ups still execute. Only the
local input box is blocked.

Codex already ships a native path for this case. The `codex queue` command delivers a message to an
existing thread through the local app-server daemon — the same transport used by the app's own
follow-up queue and by remote control. It does not touch the composer UI, so the client-side gate
does not apply to it.

## Sending to an existing thread

```powershell
codex queue --thread <thread-id-or-name> --message "continue with the next step"
```

The thread id is the UUID embedded in the rollout filename under
`~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl`. Filenames can contain two
UUIDs (`rollout-<timestamp>-<thread-id>_<rollout-id>.jsonl`); the thread id is the
first one. The helper script `scripts/codex-queue.ps1` resolves the most recent
thread automatically:

```powershell
scripts\codex-queue.ps1 "continue with the next step"
scripts\codex-queue.ps1 -Thread 019f644b-a10a-73c2-8c3f-f3c7713a2928 "status?"
```

On macOS/Linux the equivalent helper is `scripts/codex-queue.sh`.

## Starting or resuming work without the composer

`codex exec "<prompt>"` runs a complete non-interactive task, and
`codex resume --last "<prompt>"` continues the most recent session. Both bypass the composer for
the same reason: they never load the gated input surface.

## Why this is the safe fallback

- **No interception.** Nothing is proxied, patched, or injected; there is no custom CA to install
  and no TLS to terminate.
- **No app modification.** The desktop app, its asar bundle, and its update flow are untouched, so
  updates cannot break it and it cannot break updates.
- **Native surface only.** `codex queue`, `codex exec`, and `codex resume` are documented CLI
  commands that use the same app-server daemon and thread store as the app itself.
- **Quota is still enforced server-side.** This fallback only bypasses the client-side input gate.
  A thread bound to a provider whose quota is actually exhausted still fails upstream; the benefit
  is for threads routed to providers with remaining capacity (for example an opencodex pool or a
  non-OpenAI provider), which the local gate would otherwise block incorrectly.
- **Remote-friendly.** The same command works over the app's remote-control channel, so it also
  replaces the "send from another device" workaround for single-machine use.

## When the gate lifts

Nothing needs to be undone. The next composer message goes through the normal UI path again, and
queued messages already sent appear in the same thread history.
