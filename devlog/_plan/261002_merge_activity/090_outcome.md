# 090 — outcome

Record of merge activity on `dev`, 2026-09-30 13:14 → 2026-10-02 16:55 UTC plus the
2.73.0/2.74.0 release rounds that closed just before the window and the 2.76.0 round
that closed just after it. Baseline tip `21aed9fee`; upstream `dev` now ends at
`b4616be1e4` (#6462).

## Totals

- 81 first-parent commits landed on `dev` in the window: 68 uncovered merges recorded
  here, 11 merges already recorded by their own units, 2 release dev-opens (#6351,
  #6462).
- Four releases shipped: v2.73.0 (010), v2.74.0 (020), v2.75.0 (030), v2.76.0 (035) —
  8 Release runs, 7 green first attempt, 1 failed-then-resumed (2.74.0 main, same head
  `cae9b553`). Every release published 25 assets.
- Waves: 040 (20 PRs, 2.75.0 content), 050 (32 PRs, post-release lanes), 060 (7 PRs,
  Windows service/update), 070 (8 PRs, Claude page/pool + CLI), 080 (2 PRs, 10-02
  tail: #6448 and the #6462 dev-open).

## CI outcomes on merged heads

- `ci` success on head: 54 of 68 recorded merges.
- `ci` failure on head at merge: 14 — #6328 #6329 #6330 #6331(+structure gate) #6333
  #6343 #6344 #6345 #6346 #6347 #6349 #6391 #6395 #6399, and none for #6341 (no `ci`
  run). These landed under the coordinator's closing rule; the 040 wave then shipped
  verified inside the 2.75.0 release runs.
- `enforce-target` failure on head: #6383 #6400 #6401 #6402 #6403 #6404 #6407 #6441
  #6462 — external-contributor and bot heads merged by admin.
- Push-triggered CI on `dev` itself has not run since 2026-09-21; per-PR check runs on
  the exact head SHA are the CI evidence cited.

## Tracked by their own units (not duplicated)

#6366 #6367 #6389 #6390 → `devlog/_fin/261001_omo_lazycodex_carry/`;
#6361 #6363 → `devlog/_plan/261001_quota_send_lock_split/`; #6364 →
`devlog/_plan/261001_jev_decision_routing/`; #6362 →
`devlog/_plan/261001_zed_hosted_uayor_carry/`; #6418 →
`devlog/_plan/261002_claude_cli_picker/`; #6428 #6430 → `devlog/_plan/261002_claude_ux/`.

## Boundaries

- npm dist-tags not re-queried (no registry access from this lane); release evidence
  is the GitHub release objects, tags, asset counts and Release workflow runs.
- Lane review verdicts are not re-derived; tables record published merges and
  exact-head check conclusions only.
