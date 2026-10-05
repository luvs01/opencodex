# Two release objects in one round

The rows below identify the GitHub releases and their successful Release
workflow runs. Time is the GitHub `published_at` value in UTC, not workflow
start or completion time. Both release objects are non-draft.

| Tag | Published (UTC) | Release/tag commit | Successful Release run |
| --- | --- | --- | --- |
| [v2.78.0-preview.20261005](https://github.com/lidge-jun/opencodex/releases/tag/v2.78.0-preview.20261005) | 2026-10-05 10:24:55 | [`04e175f7e9`](https://github.com/lidge-jun/opencodex/commit/04e175f7e912b6073bce3997affc3867bde6a749) | [37294840779](https://github.com/lidge-jun/opencodex/actions/runs/37294840779) — success |
| [v2.78.0](https://github.com/lidge-jun/opencodex/releases/tag/v2.78.0) | 2026-10-05 12:51:55 | [`93cdffd6ac`](https://github.com/lidge-jun/opencodex/commit/93cdffd6ac7f125d4b932a6d45af5c3ab1de5156) | [37310214140](https://github.com/lidge-jun/opencodex/actions/runs/37310214140) — success |

Each tag also has an earlier successful Release dispatch on the same head
(37293114325 for the preview tag, 37305551813 for the stable tag); the listed
run is the one whose completion matches the release object's `published_at`.
Both listed runs are `workflow_dispatch` and ran the full job set: dispatch
validation, preflight, five standalone and three desktop packages,
verification and publish.

## Promotion structure

- Preview [#6630](https://github.com/lidge-jun/opencodex/pull/6630) merged as a
  merge commit onto `preview` at 09:33:55 UTC; its merge commit
  `04e175f7e912` is the tag object. The promoted head was
  [`6f1a57162f`](https://github.com/lidge-jun/opencodex/commit/6f1a57162f75061d9860b544209215053bf03dce)
  (`chore(release): 2.78.0-preview.20261005`), a version-bump commit on
  [`2eee7771a2`](https://github.com/lidge-jun/opencodex/commit/2eee7771a2a63b7db8721b8540d3349193b0abaf)
  ("Merge preview into 2.78.0-preview.20261005 promotion"), whose tree is the
  dev content tree.
- Stable [#6632](https://github.com/lidge-jun/opencodex/pull/6632) merged as a
  merge commit onto `main` at 11:30:40 UTC; its merge commit
  `93cdffd6ac7f` is the tag object. Its second parent
  [`e847a246fb`](https://github.com/lidge-jun/opencodex/commit/e847a246fbfff5600a853ab391a15364da61d8a0)
  ("Merge main into 2.78.0 promotion") merges the 2.77.0 `main` head
  `06841165f8` into the promoted dev content.
- Both GitHub PR titles carry a `[WRONG BRANCH]` prefix; the recorded merge
  bases are `preview` and `main` respectively.

Tree identity evidence: the stable tag's tree `6964886c380585e7` equals the
tree of dev commit [`0511f458f1`](https://github.com/lidge-jun/opencodex/commit/0511f458f12674f63bf3b629a0523cee246d33a0)
([#6615](https://github.com/lidge-jun/opencodex/pull/6615)) and of the
promotion head `e847a246fb` — stable 2.78.0 is exactly dev through #6615. The
preview tag's tree `1f882a72a7f0615b` is that same dev content plus the
`6f1a57162f` version bump.

## Declared dev content range

Excludes the left endpoint and includes the candidate at the right. First-parent
commit count, not a count of all transitive commits or unique features.

| Round | Range | First-parent count |
| --- | --- | --- |
| 2.78.0 | [`0818ea1812`](https://github.com/lidge-jun/opencodex/commit/0818ea1812a028e1c14cd0b0511b44863407bc52)..[`0511f458f1`](https://github.com/lidge-jun/opencodex/commit/0511f458f12674f63bf3b629a0523cee246d33a0) | 61 |

The left endpoint is the 2.77.0 candidate from the previous record. The
boundary commit `0511f458f1` is the last dev landing before the 2.79.0
dev-open [#6631](https://github.com/lidge-jun/opencodex/pull/6631), which
merged into `dev` at 11:30:32 UTC — eight seconds before the stable promotion
merged. The dev-open sits in the landing inventory's own category, not inside
this content range. No separate dispatch candidate run is claimed for this
round; per-PR and promotion merge-time checks remain outside this record.
