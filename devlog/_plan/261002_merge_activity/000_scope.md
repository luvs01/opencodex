# Merge activity record — scope

Post-hoc record of what landed on `dev` between the last recorded units and 2026-10-02
(~2026-09-30 13:14 UTC through 2026-10-02 16:55 UTC — the 2.77.0 dev-open — with the 2.76.0
release evidence that followed through 18:42 UTC, plus the 2.73.0 and 2.74.0 releases that
shipped just before the window and were never written up). Baseline tip: `21aed9fee`;
upstream `dev` now ends at `b4616be1e4`, two merges ahead of the fork.

## Tracked by its own unit — not duplicated here

| Unit | Record |
|---|---|
| omo / LazyCodex carry (#6366 #6367 #6389, close #6390) | `devlog/_fin/261001_omo_lazycodex_carry/` |
| Quota send-lock split (#6361 shim, #6363 hard-lock) | `devlog/_plan/261001_quota_send_lock_split/` |
| JEV decision methods (#6364) | `devlog/_plan/261001_jev_decision_routing/` |
| Zed Hosted AI carry (#6362, source #5912) | `devlog/_plan/261001_zed_hosted_uayor_carry/` |
| Claude CLI first-party picker (#6418) | `devlog/_plan/261002_claude_cli_picker/` |
| Claude UX: intercept-on-demand + Claude page (#6428 #6430) | `devlog/_plan/261002_claude_ux/` |

## Method

Per PR: number, author, carry source where the commit title names one, head SHA, squash SHA on
`dev`, and the exact-head `ci` aggregate and `enforce-target` conclusions from GitHub check runs.
Lane review verdicts (Kimi/Sol/Codex) are not re-derived here — the table records the published
merge and CI evidence only. Runs are cited by run id; links point at lidge-jun/opencodex.

Files: 010–035 the four release rounds, 040–080 the merge waves in landing order, 090 totals.
