# One release round

The row below identifies the GitHub release and its successful Release
workflow run. Time is the GitHub `published_at` value in UTC, not workflow
start or completion time. The release object is non-draft.

| Tag | Published (UTC) | Release/tag commit | Successful Release run |
| --- | --- | --- | --- |
| [v2.77.0](https://github.com/lidge-jun/opencodex/releases/tag/v2.77.0) | 2026-10-04 02:40:47 | [`06841165f8`](https://github.com/lidge-jun/opencodex/commit/06841165f884a9176d701310638b2112aca7a514) | [37170949169](https://github.com/lidge-jun/opencodex/actions/runs/37170949169) — success |

No preview tag exists for 2.77.0: the round ran candidate acceptance → stable
publication directly. The candidate acceptance evidence, the promotion PR #6550
(admin merge to `main` at `06841165f8`, tree identical to candidate `0818ea1812`),
the npm/GitHub-release asset inventory and the install smoke are already recorded
in [release stabilization](../../_plan/261003_release_stabilization/031_publication_outcome.md)
through [`#6561`](https://github.com/lidge-jun/opencodex/pull/6561); this file
cross-references rather than repeats them.

## Declared dev content range

Excludes the left endpoint and includes the candidate at the right. First-parent
commit count, not a count of all transitive commits or unique features.

| Round | Range | First-parent count |
| --- | --- | --- |
| 2.77.0 | [`e0af52c8a2`](https://github.com/lidge-jun/opencodex/commit/e0af52c8a2701dccd81fa5e672c92744e59d2e29)..[`0818ea181`](https://github.com/lidge-jun/opencodex/commit/0818ea1812a028e1c14cd0b0511b44863407bc52) | 32 |

The left endpoint is the 2.76.0 candidate from the previous record. The 2.77.0
dev-open [#6549](https://github.com/lidge-jun/opencodex/pull/6549) (open dev at
2.78.0 before releasing 2.77.0) precedes the release and sits inside the landing
inventory's dev-open category, not inside this content range.

## Dispatch candidate CI

The recovered train's final cross-platform gate: Cross-platform CI
[37110109894](https://github.com/lidge-jun/opencodex/actions/runs/37110109894),
`workflow_dispatch`, head [`7c59baf959`](https://github.com/lidge-jun/opencodex/commit/7c59baf9597fbad188c49bb562bdd4858275766d),
success on 2026-10-03 08:33 UTC — the first dispatch after the last
train-recovery landing ([#6495](https://github.com/lidge-jun/opencodex/pull/6495)).
This is the run the stabilization unit's starting state measured against; it is
candidate CI evidence, distinct from the Release run above and from per-PR
merge-time checks, which remain outside this record.
