# Landing inventory

The [fixed scope](000_scope.md) contains 47 first-parent landings:
**11 + 35 + 1**. Tables preserve first-parent landing order, oldest first.
The 11-entry inventory fills the coverage gap; "covered" refers to the
documentation units listed below, not an assertion that no other document
anywhere mentions these changes.

## 11 landings recorded here

| PR | Landing commit | Published change |
| --- | --- | --- |
| [#6494](https://github.com/lidge-jun/opencodex/pull/6494) | [`4b98328dc`](https://github.com/lidge-jun/opencodex/commit/4b98328dc) | fix(update): normalize short Windows home paths for Scoop npm |
| [#6495](https://github.com/lidge-jun/opencodex/pull/6495) | [`7c59baf95`](https://github.com/lidge-jun/opencodex/commit/7c59baf95) | test: drain Windows ACL work and startup child output |
| [#6540](https://github.com/lidge-jun/opencodex/pull/6540) | [`9f23b1fa9`](https://github.com/lidge-jun/opencodex/commit/9f23b1fa9) | fix(combo): preserve bounded nested HTTP refusal semantics |
| [#6551](https://github.com/lidge-jun/opencodex/pull/6551) | [`df3dd3f11`](https://github.com/lidge-jun/opencodex/commit/df3dd3f11) | fix(claude): preserve bounded large headers in picker relay |
| [#6565](https://github.com/lidge-jun/opencodex/pull/6565) | [`7edad584b`](https://github.com/lidge-jun/opencodex/commit/7edad584b) | fix(devin): qualify child trajectories by supplied parent |
| [#6553](https://github.com/lidge-jun/opencodex/pull/6553) | [`9289396e5`](https://github.com/lidge-jun/opencodex/commit/9289396e5) | fix(codex): require saved config authority for routed removal |
| [#6558](https://github.com/lidge-jun/opencodex/pull/6558) | [`f74a3db92`](https://github.com/lidge-jun/opencodex/commit/f74a3db92) | fix(codex): bind catalog writes to home ownership and intent |
| [#6560](https://github.com/lidge-jun/opencodex/pull/6560) | [`8aff79ed2`](https://github.com/lidge-jun/opencodex/commit/8aff79ed2) | feat(codex): audit catalog writes with bounded private records |
| [#6563](https://github.com/lidge-jun/opencodex/pull/6563) | [`33185c2cc`](https://github.com/lidge-jun/opencodex/commit/33185c2cc) | feat(codex): heal lost catalog rows only from the idle owner |
| [#6579](https://github.com/lidge-jun/opencodex/pull/6579) | [`a6bc60816`](https://github.com/lidge-jun/opencodex/commit/a6bc60816) | feat(gui): icon theme switch sharing a row with the zoom stepper |
| [#6583](https://github.com/lidge-jun/opencodex/pull/6583) | [`584b92a53`](https://github.com/lidge-jun/opencodex/commit/584b92a53) | test(layout): compact the test-layout fixture to restore ratchet headroom |

Batch context for these rows:

- #6494 and #6495 are the two Windows tail merges of the recovered
  contributor train ([train recovery](../../_plan/261003_train_recovery/000_plan.md)):
  Scoop home canonicalization plus test lifecycle drains. The dispatch
  candidate CI that followed them is in [010_releases.md](010_releases.md).
- #6540 is the nested-HTTP refusal repair that
  [012_integration_evidence](../../_plan/261003_release_stabilization/012_integration_evidence.md)
  assigned as a follow-up after the #6527 post-merge review.
- #6551 and #6565 are unrecorded follow-ups to lanes that do have units:
  picker-relay headers adjacent to Claude preservation, and parent-qualified
  child trajectories extending [cache identity](../../_plan/261004_cache_identity/020_devin.md).
- #6553/#6558/#6560/#6563 are the four `next-release-261004-catalog-a*`
  merges: saved-config/combo authority for routed catalog mutation, journal
  writer entrypoint ownership, bounded private write-audit records (Windows
  audit-stream coverage deferred per the a3 docs commit), and idle-owner-only
  catalog heal with startup observation and path-alias fencing. No unit
  covered this lane.
- #6579 and #6583 are standalone GUI/test landings.

## 35 landings covered by existing units

These are 35 landings across eleven documentation units, not 35 separate
units. The paths below reflect the fixed upstream snapshot; linking an open
unit does not mark its remaining work complete.

| PR | Landing commit | Published change |
| --- | --- | --- |
| [#6475](https://github.com/lidge-jun/opencodex/pull/6475) | [`4b7466833`](https://github.com/lidge-jun/opencodex/commit/4b7466833) | fix(gui): remove blank tail from account-page scrolling |
| [#6484](https://github.com/lidge-jun/opencodex/pull/6484) | [`8efd79ca5`](https://github.com/lidge-jun/opencodex/commit/8efd79ca5) | fix(claude): register subagents after first-party setup |
| [#6482](https://github.com/lidge-jun/opencodex/pull/6482) | [`762501439`](https://github.com/lidge-jun/opencodex/commit/762501439) | fix(grok): forward the Grok conversation as session_id so OpenAI prefixes stay warm |
| [#6474](https://github.com/lidge-jun/opencodex/pull/6474) | [`2e3acab46`](https://github.com/lidge-jun/opencodex/commit/2e3acab46) | docs(providers): update TokenLab docs links |
| [#6459](https://github.com/lidge-jun/opencodex/pull/6459) | [`ee2e15f86`](https://github.com/lidge-jun/opencodex/commit/ee2e15f86) | fix(cli): preserve JSON while escaping human output |
| [#6455](https://github.com/lidge-jun/opencodex/pull/6455) | [`115fa0322`](https://github.com/lidge-jun/opencodex/commit/115fa0322) | fix(service): keep backup names out of Windows cmd logging |
| [#6457](https://github.com/lidge-jun/opencodex/pull/6457) | [`9fb79230b`](https://github.com/lidge-jun/opencodex/commit/9fb79230b) | fix(claude): preserve legacy cleanup before startup prechecks |
| [#6487](https://github.com/lidge-jun/opencodex/pull/6487) | [`3ada270f3`](https://github.com/lidge-jun/opencodex/commit/3ada270f3) | fix: integrate reviewed provider, client, and desktop recovery trajectories |
| [#6489](https://github.com/lidge-jun/opencodex/pull/6489) | [`452f9a404`](https://github.com/lidge-jun/opencodex/commit/452f9a404) | feat: add Claude subagent force and Remote Link setup recovery |
| [#6490](https://github.com/lidge-jun/opencodex/pull/6490) | [`b254139e2`](https://github.com/lidge-jun/opencodex/commit/b254139e2) | fix: resolve late train review findings and regression gaps |
| [#6501](https://github.com/lidge-jun/opencodex/pull/6501) | [`3bae88cce`](https://github.com/lidge-jun/opencodex/commit/3bae88cce) | fix(antigravity): group discovered effort families across versions |
| [#6506](https://github.com/lidge-jun/opencodex/pull/6506) | [`67c4049ff`](https://github.com/lidge-jun/opencodex/commit/67c4049ff) | fix(cli): keep restart rechecks within their deadline |
| [#6498](https://github.com/lidge-jun/opencodex/pull/6498) | [`b82b39018`](https://github.com/lidge-jun/opencodex/commit/b82b39018) | feat(cli): add explicit help paths and complete reference |
| [#6500](https://github.com/lidge-jun/opencodex/pull/6500) | [`cb2d1736a`](https://github.com/lidge-jun/opencodex/commit/cb2d1736a) | feat(cli): organize help around common tasks |
| [#6503](https://github.com/lidge-jun/opencodex/pull/6503) | [`9f89b7265`](https://github.com/lidge-jun/opencodex/commit/9f89b7265) | feat(cli): guide recovery from command typos |
| [#6513](https://github.com/lidge-jun/opencodex/pull/6513) | [`e77bfb490`](https://github.com/lidge-jun/opencodex/commit/e77bfb490) | fix(responses): stabilize large native HTTP uploads (carry #6508) |
| [#6519](https://github.com/lidge-jun/opencodex/pull/6519) | [`a141b8362`](https://github.com/lidge-jun/opencodex/commit/a141b8362) | fix(ollama-native): retain tool batches across assistant commentary |
| [#6516](https://github.com/lidge-jun/opencodex/pull/6516) | [`36330ae2e`](https://github.com/lidge-jun/opencodex/commit/36330ae2e) | fix(claude): keep native context failures terminal in Messages |
| [#6514](https://github.com/lidge-jun/opencodex/pull/6514) | [`aa40fb415`](https://github.com/lidge-jun/opencodex/commit/aa40fb415) | fix(antigravity): group Claude 5.5 usage and derive reference prices |
| [#6515](https://github.com/lidge-jun/opencodex/pull/6515) | [`e601cefce`](https://github.com/lidge-jun/opencodex/commit/e601cefce) | fix(codex): classify revoked native sessions without stale attribution |
| [#6518](https://github.com/lidge-jun/opencodex/pull/6518) | [`358b8ffd4`](https://github.com/lidge-jun/opencodex/commit/358b8ffd4) | fix(oauth): preserve Claude identity across token rotation (carry #6378) |
| [#6517](https://github.com/lidge-jun/opencodex/pull/6517) | [`a99de42e7`](https://github.com/lidge-jun/opencodex/commit/a99de42e7) | fix(security): stabilize standalone pairing for Child enrollment |
| [#6523](https://github.com/lidge-jun/opencodex/pull/6523) | [`a41f67273`](https://github.com/lidge-jun/opencodex/commit/a41f67273) | fix(codex): preserve stored-main ownership and scoped refresh refusal |
| [#6527](https://github.com/lidge-jun/opencodex/pull/6527) | [`ab6853903`](https://github.com/lidge-jun/opencodex/commit/ab6853903) | fix(combos): preserve plan-model refusal evidence through error projection |
| [#6536](https://github.com/lidge-jun/opencodex/pull/6536) | [`dd9a980ec`](https://github.com/lidge-jun/opencodex/commit/dd9a980ec) | docs: record native account carry publication |
| [#6538](https://github.com/lidge-jun/opencodex/pull/6538) | [`efc20e700`](https://github.com/lidge-jun/opencodex/commit/efc20e700) | fix(spend): refuse unbooked dispatches under applicable ceilings |
| [#6541](https://github.com/lidge-jun/opencodex/pull/6541) | [`3541261ac`](https://github.com/lidge-jun/opencodex/commit/3541261ac) | docs: record scoped release stabilization and verification gates |
| [#6543](https://github.com/lidge-jun/opencodex/pull/6543) | [`0818ea181`](https://github.com/lidge-jun/opencodex/commit/0818ea181) | test: isolate release fixtures and release holder leases cooperatively |
| [#6561](https://github.com/lidge-jun/opencodex/pull/6561) | [`596525686`](https://github.com/lidge-jun/opencodex/commit/596525686) | docs: record 2.77.0 candidate acceptance and publication |
| [#6554](https://github.com/lidge-jun/opencodex/pull/6554) | [`f85925d87`](https://github.com/lidge-jun/opencodex/commit/f85925d87) | fix(server): promote scoped caller conversation headers |
| [#6557](https://github.com/lidge-jun/opencodex/pull/6557) | [`be297a52c`](https://github.com/lidge-jun/opencodex/commit/be297a52c) | fix(devin): retain bounded conversation trajectories |
| [#6555](https://github.com/lidge-jun/opencodex/pull/6555) | [`16d5daecd`](https://github.com/lidge-jun/opencodex/commit/16d5daecd) | fix(responses): share reset replay grants across translated sends |
| [#6552](https://github.com/lidge-jun/opencodex/pull/6552) | [`045584583`](https://github.com/lidge-jun/opencodex/commit/045584583) | fix(anthropic): preserve deferred and inline native tool names |
| [#6559](https://github.com/lidge-jun/opencodex/pull/6559) | [`26dd8cf65`](https://github.com/lidge-jun/opencodex/commit/26dd8cf65) | fix(anthropic): preserve native Claude requests across pooled dispatch |
| [#6562](https://github.com/lidge-jun/opencodex/pull/6562) | [`33125e62d`](https://github.com/lidge-jun/opencodex/commit/33125e62d) | feat(anthropic): add native pool preference with explicit opt-out precedence |

| Covered PRs | Existing record |
| --- | --- |
| #6475 | [dashboard scroll gap](../261003_dashboard_scroll_gap/000_plan.md) |
| #6484 | [Claude first-party agents](../261003_claude_1p_agents/000_plan.md) |
| #6474, #6482, #6459, #6455, #6457 | [train recovery carry ledger + baseline](../../_plan/261003_train_recovery/030_carry_ledger.md) |
| #6487 | [train recovery](../../_plan/261003_train_recovery/000_plan.md) + [lane A](../../_plan/261003_train_recovery_a/000_plan.md) + [lane D](../../_plan/261003_train_recovery_d/000_verification.md) |
| #6489 | [lane E recovery](../../_plan/261003_lane_e_recovery/090_summary.md) |
| #6490 | [lane D late review](../../_plan/261003_train_recovery_d/010_late_review.md) |
| #6506 | [CLI help UX deadline prerequisite](../261003_cli_help_ux/041_deadline_prerequisite.md) |
| #6498, #6500, #6503 | [CLI help UX](../261003_cli_help_ux/090_outcome.md) (closed, moved to `_fin` by #6503) |
| #6501 | [release lane C antigravity](../../_plan/261003_release_lane_c/010_antigravity.md) |
| #6513, #6516 | [release lane A](../../_plan/261003_release_lane_a/000_plan.md) + [integration evidence](../../_plan/261003_release_stabilization/012_integration_evidence.md) |
| #6514, #6519 | [release lane C](../../_plan/261003_release_lane_c/000_plan.md) + [ollama replay](../../_plan/261003_ollama_commentary_replay/000_plan.md) + integration evidence |
| #6515, #6517, #6518, #6523, #6527, #6538 | [integration evidence](../../_plan/261003_release_stabilization/012_integration_evidence.md) |
| #6536, #6541 | [release stabilization unit](../../_plan/261003_release_stabilization/000_plan.md) — self-recording documentation PRs |
| #6543 | [fixture isolation stabilization](../../_plan/261004_fixture_isolation_stabilization/000_plan.md) |
| #6561 | [2.77.0 acceptance + publication](../../_plan/261003_release_stabilization/031_publication_outcome.md) |
| #6554, #6557 | [cache identity](../../_plan/261004_cache_identity/000_plan.md) |
| #6555 | [translated reset retry](../../_plan/261004_translated_reset_retry/000_plan.md) |
| #6552, #6559, #6562 | [Claude request preservation](../../_plan/261004_claude_request_preservation/000_plan.md) |

## One release dev-open

| PR | Landing commit | Published change |
| --- | --- | --- |
| [#6549](https://github.com/lidge-jun/opencodex/pull/6549) | [`87e315633`](https://github.com/lidge-jun/opencodex/commit/87e3156339) | chore(release): open dev at 2.78.0 before releasing 2.77.0 |

The 2.78.0 dev-open precedes the 2.77.0 publication in
[010_releases.md](010_releases.md) and is recorded in the stabilization unit's
[candidate acceptance](../../_plan/261003_release_stabilization/022_candidate_acceptance.md).
Like the previous record, release dev-opens are their own disjoint category.
