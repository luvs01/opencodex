---
name: testing-opencodex-management-api
description: Run the opencodex proxy locally against a scratch home and exercise the management /api/* endpoints with admin-token auth (Windows + bun).
---

# Testing the opencodex management API locally

## Start a scratch instance
- `OPENCODEX_HOME` relocates OpenCodex-owned state ONLY (config.json, admin-api-token,
  lab automation state, SQLite projections). Client homes are NOT relocated: startup
  syncs can still write to the real `~/.codex`, `~/.grok`, `~/.claude`, and Claude
  Desktop dirs. Point these at scratch too: `CODEX_HOME`, `GROK_HOME`,
  `CLAUDE_CONFIG_DIR`, `OPENCODEX_CLAUDE_DESKTOP_CONFIG_DIR`.
- `codexAutoStart:false` does NOT gate startup client syncs: `shouldSyncCodexOnStart`
  reads `clientIntegrations.codex` (absent = ON), `shouldSyncGrokOnStart` reads
  `clientIntegrations.grok`, and the Claude roster write (`ocx-*.md` into
  `~/.claude/agents/`) is gated by `claudeCode.enabled`/`claudeCode.injectAgents`.
  Observed: a run with only OPENCODEX_HOME + codexAutoStart:false still injected five
  `ocx-*.md` files into the real `~/.claude/agents/`.
- Safe scratch `config.json`:
  `{"port":<testport>,"hostname":"127.0.0.1","codexAutoStart":false,
   "clientIntegrations":{"codex":false,"grok":false,"claude-desktop":false},
   "claudeCode":{"injectAgents":false}}`
  — loopback bind avoids the server-auth assert. Use the env vars AND the config
  disables together; either alone leaves a write path open (e.g. a disabled
  integration still prunes its owned files under the real home).
- Residual writes the recipe does NOT cover (macOS only, opencodex-owned artifacts
  only): startup always runs `refreshOwnedRaycastCatalog` (rewrites an existing
  opencodex-owned Raycast provider entry under the OS home — no env override) and
  `reconcileShellHook` (removes the opencodex-marked block from `~/.zshrc` when the
  system env is inactive — `CLAUDE_CONFIG_DIR` does not redirect it). Harmless on a
  box with neither installed; for hermetic isolation on macOS run under a disposable
  OS user/home instead.
- Management auth: set `OPENCODEX_ADMIN_AUTH_TOKEN` (any non-empty string works for the env
  source). If unset, the server mints `admin-api-token` in OPENCODEX_HOME on first start.
- Start foreground: `bun run src/cli/index.ts start --port <testport>`
  (`bun run dev` is the same). bun is not on PATH — prefix `PATH="$HOME/.bun/bin:$PATH"`
  in Git Bash. `ocx ensure`/tray paths spawn DETACHED children instead — avoid them for testing.

## Calling /api/*
- Header: `x-opencodex-api-key: <token>` (or `Authorization: Bearer <token>`). No token →
  `401 {"error":"opencodex admin token required"}`. Origin header NOT required for curl.
- Useful routes: `GET/PUT /api/lab/automation` (status has `schedulerRunning` — live
  interval presence, not just policy), `POST /api/lab/automation/run` (SYNCHRONOUS — the
  200 response IS the terminal run record), `GET /api/lab/automation/runs`.
- PUT policy body: `{"policy":{"enabled":true,"layers":{"protocolConformance":true}}}`;
  merges with disk policy atomically.
- Manual run body: `{"evidenceLayer":"protocol_conformance","scenarioId":"responses-core.protocol.request-shape"}`
  — protocol_conformance runs need NO provider (in-process fixture harness; upstream is
  deliberately dead). live_route_compatibility needs providerName+modelId in config.
- Scheduler tick is `LAB_AUTOMATION_HARD_MAX.schedulerTickMs` = 60s — scheduled work only
  appears in `/runs` after the first tick; runs persist to `<OPENCODEX_HOME>/lab/automation-state.json`.

## Windows desktop quirks
- The exec tool CANNOT spawn visible desktop windows (`cmd //c start` hangs the shell on
  the inherited pipe). Open interactive windows via the computer tool: `super+r` →
  `cmd /k <batch>` → Enter; snap halves with `super+Left/Right`.
- Ctrl+C on a cmd batch shows `Terminate batch job (Y/N)?` — the child process still
  received SIGINT and drains normally; answer `N` to keep the window and see the exit.
- Single Ctrl+C → `🛑 Shutting down opencodex proxy...` → drainAndShutdown
  (`shutdownTimeoutMs` default 5000) → exit 0. A second signal >500ms later force-exits.

## Devin Secrets Needed
- none — the admin token is provisioned by the tester via env var.
