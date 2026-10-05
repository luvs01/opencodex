# Landing inventory

The [fixed scope](000_scope.md) contains 60 first-parent landings:
**45 + 14 + 1**. Tables preserve first-parent landing order, oldest first.
The 45-entry inventory fills the coverage gap; "covered" refers to the
documentation units listed below, not an assertion that no other document
anywhere mentions these changes. The last 29 rows were read from canonical
upstream `dev` (tip `6774f0f6f26c`, which the fork mirror has since caught up
to).

## 45 landings recorded here

| PR | Landing commit | Published change |
| --- | --- | --- |
| [#6576](https://github.com/lidge-jun/opencodex/pull/6576) | [`9096934aeb`](https://github.com/lidge-jun/opencodex/commit/9096934aeb) | fix(ollama): preserve additional tool outputs during replay |
| [#6578](https://github.com/lidge-jun/opencodex/pull/6578) | [`1b3ecb8576`](https://github.com/lidge-jun/opencodex/commit/1b3ecb8576) | test: make provider proxy fixture DNS and child lifetime deterministic |
| [#6405](https://github.com/lidge-jun/opencodex/pull/6405) | [`a0ea6d3664`](https://github.com/lidge-jun/opencodex/commit/a0ea6d3664) | test(clients): guard Kilo symlink regression on Windows |
| [#6486](https://github.com/lidge-jun/opencodex/pull/6486) | [`6e5cf45c27`](https://github.com/lidge-jun/opencodex/commit/6e5cf45c27) | fix(chatgpt): say why a dropped chatgptDesktop block reads as off |
| [#6512](https://github.com/lidge-jun/opencodex/pull/6512) | [`815b1f609f`](https://github.com/lidge-jun/opencodex/commit/815b1f609f) | feat(service): name the holder when the runtime mutation lease is busy |
| [#6572](https://github.com/lidge-jun/opencodex/pull/6572) | [`2dd3f822a0`](https://github.com/lidge-jun/opencodex/commit/2dd3f822a0) | fix(codex): honor consented credits after included quota exhaustion |
| [#6585](https://github.com/lidge-jun/opencodex/pull/6585) | [`dabaed4840`](https://github.com/lidge-jun/opencodex/commit/dabaed4840) | fix(cli): default config flags-only calls to show (carry #6483) |
| [#6586](https://github.com/lidge-jun/opencodex/pull/6586) | [`989bb24b1b`](https://github.com/lidge-jun/opencodex/commit/989bb24b1b) | fix(oauth): release Anthropic refresh intent after a proven-unsent DNS failure |
| [#6564](https://github.com/lidge-jun/opencodex/pull/6564) | [`df61d03ecc`](https://github.com/lidge-jun/opencodex/commit/df61d03ecc) | fix(combos): report the spent primary, not the fallback's own refusal |
| [#6493](https://github.com/lidge-jun/opencodex/pull/6493) | [`3953f11fa6`](https://github.com/lidge-jun/opencodex/commit/3953f11fa6) | fix(codex): skip non-executable POSIX PATH entries in readiness checks |
| [#6577](https://github.com/lidge-jun/opencodex/pull/6577) | [`de0361e63a`](https://github.com/lidge-jun/opencodex/commit/de0361e63a) | fix(droid): preserve reasoning defaults after settings normalization |
| [#6589](https://github.com/lidge-jun/opencodex/pull/6589) | [`907c6f4dbe`](https://github.com/lidge-jun/opencodex/commit/907c6f4dbe) | fix(codex): keep Unix autostart shims off package-manager paths (carry of #6301) |
| [#6522](https://github.com/lidge-jun/opencodex/pull/6522) | [`69ce37c24e`](https://github.com/lidge-jun/opencodex/commit/69ce37c24e) | fix(integrations): write DSH routes to the Desktop profile patch it reads |
| [#6599](https://github.com/lidge-jun/opencodex/pull/6599) | [`164786a41e`](https://github.com/lidge-jun/opencodex/commit/164786a41e) | test(cli): make audio device refusal and login child import portable to Windows |
| [#6600](https://github.com/lidge-jun/opencodex/pull/6600) | [`8ef6ad949e`](https://github.com/lidge-jun/opencodex/commit/8ef6ad949e) | test(oauth): make the startup-proxy refresh test hold on Windows |
| [#6602](https://github.com/lidge-jun/opencodex/pull/6602) | [`e53c8077e4`](https://github.com/lidge-jun/opencodex/commit/e53c8077e4) | test: make catalog audit and provider proxy fixture robust on Windows; state unhealthy in-place shim status |
| [#6597](https://github.com/lidge-jun/opencodex/pull/6597) | [`e0238355da`](https://github.com/lidge-jun/opencodex/commit/e0238355da) | feat(integrations): show the missing-store remedy in the dashboard |
| [#6607](https://github.com/lidge-jun/opencodex/pull/6607) | [`84311893a5`](https://github.com/lidge-jun/opencodex/commit/84311893a5) | fix(cli): explain Codex shim overlay migration and activation in status and doctor |
| [#6611](https://github.com/lidge-jun/opencodex/pull/6611) | [`29f8a38812`](https://github.com/lidge-jun/opencodex/commit/29f8a38812) | fix(cli): show account health actions, paid-credit consent, and empty-list next steps |
| [#6609](https://github.com/lidge-jun/opencodex/pull/6609) | [`a055b67d73`](https://github.com/lidge-jun/opencodex/commit/a055b67d73) | fix(cli): correct help and CLI reference text and show declared flags in leaf help |
| [#6619](https://github.com/lidge-jun/opencodex/pull/6619) | [`f89e42ab79`](https://github.com/lidge-jun/opencodex/commit/f89e42ab79) | fix(update): stop-first manual reinstall guidance; refresh shim, update-failed, and ZCode guide text |
| [#6601](https://github.com/lidge-jun/opencodex/pull/6601) | [`fe09557cb9`](https://github.com/lidge-jun/opencodex/commit/fe09557cb9) | fix(management): keep inference ports independent of management ingress |
| [#6588](https://github.com/lidge-jun/opencodex/pull/6588) | [`e44cada4c4`](https://github.com/lidge-jun/opencodex/commit/e44cada4c4) | fix(responses): normalize native upstream session aliases |
| [#6591](https://github.com/lidge-jun/opencodex/pull/6591) | [`10d063b302`](https://github.com/lidge-jun/opencodex/commit/10d063b302) | fix(test): keep armed test processes out of the real Codex home |
| [#6618](https://github.com/lidge-jun/opencodex/pull/6618) | [`96f0a21cb8`](https://github.com/lidge-jun/opencodex/commit/96f0a21cb8) | fix(cli): stop echoing values in claude desktop apply argument errors |
| [#6625](https://github.com/lidge-jun/opencodex/pull/6625) | [`6af4ef4c0a`](https://github.com/lidge-jun/opencodex/commit/6af4ef4c0a) | fix(gui): keep Claude Desktop role selects inside the Models card |
| [#6623](https://github.com/lidge-jun/opencodex/pull/6623) | [`4a7d96e165`](https://github.com/lidge-jun/opencodex/commit/4a7d96e165) | fix(gui): integration dialog starts on Close; client status failure offers Retry |
| [#6622](https://github.com/lidge-jun/opencodex/pull/6622) | [`b8d030205c`](https://github.com/lidge-jun/opencodex/commit/b8d030205c) | fix(cli): name ocx start when integration preview finds no running proxy |
| [#6608](https://github.com/lidge-jun/opencodex/pull/6608) | [`62fa24d70d`](https://github.com/lidge-jun/opencodex/commit/62fa24d70d) | fix(cli): reject arguments to uninstall and redact credential values in argument errors |
| [#6614](https://github.com/lidge-jun/opencodex/pull/6614) | [`f9e3678e34`](https://github.com/lidge-jun/opencodex/commit/f9e3678e34) | fix(cli): honest exit codes and JSON receipts for config, alias, health, update; validate provider add before saving |
| [#6615](https://github.com/lidge-jun/opencodex/pull/6615) | [`0511f458f1`](https://github.com/lidge-jun/opencodex/commit/0511f458f1) | fix(cli): name the real cause and next action in restart, update, and management refusals |
| [#6634](https://github.com/lidge-jun/opencodex/pull/6634) | [`0889b607fa`](https://github.com/lidge-jun/opencodex/commit/0889b607fa) | fix(claude): strip Claude Code's rotating billing line before Responses instructions (carry #6627) |
| [#6636](https://github.com/lidge-jun/opencodex/pull/6636) | [`37189ca3c6`](https://github.com/lidge-jun/opencodex/commit/37189ca3c6) | fix(devin): combine consecutive tool results for one invocation (carry #6584) |
| [#6638](https://github.com/lidge-jun/opencodex/pull/6638) | [`7e7468af0d`](https://github.com/lidge-jun/opencodex/commit/7e7468af0d) | fix(web-search): budget batched results per query so none are dropped |
| [#6626](https://github.com/lidge-jun/opencodex/pull/6626) | [`bdcfa23576`](https://github.com/lidge-jun/opencodex/commit/bdcfa23576) | docs(service): translate the busy-lease guidance on every locale page |
| [#6582](https://github.com/lidge-jun/opencodex/pull/6582) | [`60d80f7c0d`](https://github.com/lidge-jun/opencodex/commit/60d80f7c0d) | fix(logs): identify decode estimate timing basis |
| [#6617](https://github.com/lidge-jun/opencodex/pull/6617) | [`e2b6eef5c1`](https://github.com/lidge-jun/opencodex/commit/e2b6eef5c1) | fix(messages): enforce admission scope on Advisor models |
| [#6581](https://github.com/lidge-jun/opencodex/pull/6581) | [`c566bb5a33`](https://github.com/lidge-jun/opencodex/commit/c566bb5a33) | fix(gui): guide native login switching and manual retry |
| [#6624](https://github.com/lidge-jun/opencodex/pull/6624) | [`bd1b5f8624`](https://github.com/lidge-jun/opencodex/commit/bd1b5f8624) | fix(codex): synchronize manual account pause across matching main and pool entries |
| [#6587](https://github.com/lidge-jun/opencodex/pull/6587) | [`f71d560024`](https://github.com/lidge-jun/opencodex/commit/f71d560024) | fix(cli): cover the bounded startup health probe read |
| [#6639](https://github.com/lidge-jun/opencodex/pull/6639) | [`46a9bed9c3`](https://github.com/lidge-jun/opencodex/commit/46a9bed9c3) | fix(claude): retain approved Desktop picker trust across restarts |
| [#6637](https://github.com/lidge-jun/opencodex/pull/6637) | [`648cbe91f1`](https://github.com/lidge-jun/opencodex/commit/648cbe91f1) | ci: typecheck gui/ in prepush when the branch changes it (carry #6485, #6592) |
| [#6616](https://github.com/lidge-jun/opencodex/pull/6616) | [`7e3e37a651`](https://github.com/lidge-jun/opencodex/commit/7e3e37a651) | fix(responses): redact terminal reset-replacement errors |
| [#6606](https://github.com/lidge-jun/opencodex/pull/6606) | [`d00ec9f46e`](https://github.com/lidge-jun/opencodex/commit/d00ec9f46e) | fix(codex): enforce stored-account credit policy through dispatch |
| [#6605](https://github.com/lidge-jun/opencodex/pull/6605) | [`6774f0f6f2`](https://github.com/lidge-jun/opencodex/commit/6774f0f6f2) | fix(gui): require one-use config write intent for standalone pairing |

Batch context for these rows:

- #6576 is an unrecorded follow-up to a lane that has a unit:
  [ollama commentary replay](../../_plan/261003_ollama_commentary_replay/000_plan.md)
  covered #6519's tool-batch retention; this preserves additional tool outputs
  during replay.
- #6405's earlier broader content was already carried through
  [train recovery](../../_plan/261003_train_recovery/030_carry_ledger.md)
  (lane D); this landing adds the Windows symlink guard for its Kilo test.
- #6585 and #6589 carry previously owned or deferred sources: #6483
  ([CLI help UX](../261003_cli_help_ux/001_evidence.md)) and #6301 (on the
  train-recovery deferred list). #6634, #6636 and #6637 carry #6627, #6584
  and #6485+#6592 respectively.
- #6578, #6405, #6599, #6600, #6602 and #6591 continue the Windows test
  stabilization tail that the previous window ended on (#6494, #6495, #6583):
  deterministic fixtures, portable imports and child lifetime, plus a safety
  fence keeping armed test processes out of the real Codex home.
- The #6607–#6619 group (#6607, #6611, #6609, #6619, #6618, #6622, #6608,
  #6614, #6615, #6587) is a CLI honesty wave: help/reference corrections,
  account-health actions and consent surfacing, honest exit codes and JSON
  receipts, argument redaction, named causes and next actions in refusals,
  stop-first reinstall guidance and the bounded startup health probe. #6615
  is also the 2.78.0 content boundary ([010_releases.md](010_releases.md));
  everything up to it is what the release ships.
- GUI wave: #6597 (missing-store remedy; the R4 audit unit lists it for
  post-landing audit), #6625, #6623, #6581, #6605. #6522's rendered DSH
  surface was already in the audit's declared scope.
- #6626 translates the busy-lease guidance #6512 introduced.

## 14 landings covered by existing units

| PR | Landing commit | Published change |
| --- | --- | --- |
| [#6569](https://github.com/lidge-jun/opencodex/pull/6569) | [`accd69444c`](https://github.com/lidge-jun/opencodex/commit/accd69444c) | fix(server): wait for a complete Bun before restarting onto a replaced package tree |
| [#6593](https://github.com/lidge-jun/opencodex/pull/6593) | [`01a99237c8`](https://github.com/lidge-jun/opencodex/commit/01a99237c8) | feat(gui): group the sidebar into eight rows and tidy the Claude surface |
| [#6556](https://github.com/lidge-jun/opencodex/pull/6556) | [`7cf1b7624a`](https://github.com/lidge-jun/opencodex/commit/7cf1b7624a) | fix(cli): guard standalone update restart with exact replacement verification |
| [#6526](https://github.com/lidge-jun/opencodex/pull/6526) | [`5c645e398a`](https://github.com/lidge-jun/opencodex/commit/5c645e398a) | feat(cli): make existing management workflows discoverable |
| [#6528](https://github.com/lidge-jun/opencodex/pull/6528) | [`a8d8562d44`](https://github.com/lidge-jun/opencodex/commit/a8d8562d44) | Merge pull request #6528 — cli-parity-providers |
| [#6535](https://github.com/lidge-jun/opencodex/pull/6535) | [`4cc48d95ea`](https://github.com/lidge-jun/opencodex/commit/4cc48d95ea) | Merge pull request #6535 — cli-parity-models-routing |
| [#6539](https://github.com/lidge-jun/opencodex/pull/6539) | [`79db47c471`](https://github.com/lidge-jun/opencodex/commit/79db47c471) | Merge pull request #6539 — cli-parity-accounts-settings |
| [#6542](https://github.com/lidge-jun/opencodex/pull/6542) | [`f14e3a3207`](https://github.com/lidge-jun/opencodex/commit/f14e3a3207) | Merge pull request #6542 — cli-parity-integrations-maintenance |
| [#6545](https://github.com/lidge-jun/opencodex/pull/6545) | [`dadc2328f1`](https://github.com/lidge-jun/opencodex/commit/dadc2328f1) | Merge pull request #6545 — cli-parity-observation-api |
| [#6596](https://github.com/lidge-jun/opencodex/pull/6596) | [`c22aba6ca9`](https://github.com/lidge-jun/opencodex/commit/c22aba6ca9) | feat(gui): one-page Claude Code settings and Desktop model roles |
| [#6595](https://github.com/lidge-jun/opencodex/pull/6595) | [`829a18ba94`](https://github.com/lidge-jun/opencodex/commit/829a18ba94) | docs(devlog): close the CLI update restart unit with its delivery outcome |
| [#6612](https://github.com/lidge-jun/opencodex/pull/6612) | [`33ec795e40`](https://github.com/lidge-jun/opencodex/commit/33ec795e40) | fix(gui): short sidebars, Claude sidecar rows, Save errors and legacy #debug after the GUI regroup |
| [#6613](https://github.com/lidge-jun/opencodex/pull/6613) | [`e9d5908e3a`](https://github.com/lidge-jun/opencodex/commit/e9d5908e3a) | docs: sync Connect, Claude settings and DSH profile-patch guides with the dashboard |
| [#6610](https://github.com/lidge-jun/opencodex/pull/6610) | [`aa10846a4c`](https://github.com/lidge-jun/opencodex/commit/aa10846a4c) | fix(claude): serve the Desktop picker over HTTP/2 so SSE streams cannot starve claude.ai (#6511) |

| Covered PRs | Existing record |
| --- | --- |
| #6569 | [CLI update restart delivery](../261004_cli_update_restart/010_delivery.md) — records it landing first inside #6556's head |
| #6556, #6595 | [CLI update restart](../261004_cli_update_restart/000_plan.md) — unit created by #6556, closed to `_fin` by #6595 |
| #6593 | [sidebar seven groups](../../_plan/261004_sidebar_seven_groups/030_refine_and_land_outcome.md) |
| #6526, #6528, #6535, #6539, #6542, #6545 | [CLI–GUI parity](../261003_cli_gui_parity/090_acceptance_closure.md) — the six-layer stack |
| #6596 | [Claude settings UX](../261005_claude_settings_ux/000_plan.md) |
| #6610 | [Claude picker HTTP/2](../../_plan/261005_claude_picker_h2/010_plan.md) (carries #6511) |
| #6612, #6613 | [R4 GUI audit](../../_plan/261005_r4_gui_audit/030_fix_plan.md) — its wp2 PRs A and B |

The cli-parity stack (#6526 → #6545) landed as one squash plus five merge
commits, preserving the layer chain the unit describes; the merge commits
also absorbed small dev-sync repairs (pool-save bookkeeping, nativeMessages
capability acceptance, the DSH profile-patch path, catalog-owner refusal
surfacing) that rode inside the stack branches.

## One release dev-open

| PR | Landing commit | Published change |
| --- | --- | --- |
| [#6631](https://github.com/lidge-jun/opencodex/pull/6631) | [`3e739d2056`](https://github.com/lidge-jun/opencodex/commit/3e739d2056) | chore(release): open dev at 2.79.0 before releasing 2.78.0 |

The 2.79.0 dev-open precedes the 2.78.0 stable publication in
[010_releases.md](010_releases.md) and marks the end of that release's
content range. Like the previous record, release dev-opens are their own
disjoint category.
