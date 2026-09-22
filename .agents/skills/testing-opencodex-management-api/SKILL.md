---
name: testing-opencodex-management-api
description: Run the opencodex proxy locally against a scratch home and exercise the management /api/* endpoints with admin-token auth (Windows + bun).
---

# Testing the opencodex management API locally

## Start a scratch instance
- `OPENCODEX_HOME` relocates ALL opencodex state (config.json, admin-api-token, lab
  automation state, SQLite projections). Always set it to a scratch dir so a test run
  never touches the real `~/.opencodex`.
- Minimal scratch `config.json`: `{"port":<testport>,"hostname":"127.0.0.1","codexAutoStart":false}`
  — loopback bind avoids the server-auth assert, and `codexAutoStart:false` skips client-
  config writes (harmless anyway when no Codex CLI is installed).
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
