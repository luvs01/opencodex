# Merge record 2026-10-04 → 2026-10-05 — scope

Status: DONE — historical record of published work.

This continues [261004_merge_record](https://github.com/luvs01/opencodex/blob/e08ed92efed9a7cd54aac53b2ca62546b9b6d6a1/devlog/_fin/261004_merge_record/000_scope.md)
(`devin/devlog-261004` on luvs01/opencodex at
[`e08ed92ef`](https://github.com/luvs01/opencodex/commit/e08ed92efed9a7cd54aac53b2ca62546b9b6d6a1),
recorded but not yet landed upstream) with the
same method and the same limits, checked against canonical upstream git history,
GitHub pull requests, release objects, tags and Actions runs.

The window boundaries below are defined by canonical upstream first-parent
history alone, so they stand whether or not the predecessor record ever merges;
the link exists only so a reader can chain the coverage narrative. If the
predecessor lands after this one, upstream history will contain this record
referencing an unlanded ancestor — the same state the 261004 record documented
for 261002.

## Fixed boundaries

- Landing window: first-parent range
  `584b92a53cd275ef6daab66458c693e7257ffe39..6774f0f6f26c`.
  The left endpoint is excluded; it is the right endpoint of the previous record
  ([#6583](https://github.com/lidge-jun/opencodex/pull/6583), the test-layout
  ratchet compaction). The right endpoint is included and landed on 2026-10-05
  at 19:03 UTC ([#6605](https://github.com/lidge-jun/opencodex/pull/6605)).
- Release publication in the window: stable 2.78.0 published 2026-10-05
  12:51:55 UTC, preceded by preview `v2.78.0-preview.20261005` at 10:24:55 UTC.
  Unlike the 2.77.0 round, this round ran candidate → preview → stable.
- [Releases](010_releases.md): two release objects, two successful Release
  runs, two promotion merges (one onto `preview`, one onto `main`) and the
  2.79.0 dev-open. The promoted dev tree is verified against the tag trees.
- [Landings](020_landings.md): 60 first-parent commits, partitioned into
  45 entries recorded here, 14 landings covered by existing documentation
  units, and one release dev-open. These categories are disjoint.

## Method and limits

The landing PR is the final PR number in each upstream first-parent commit
subject, cross-checked against its merged PR's `merge_commit_sha` and `dev`
base. Earlier PR numbers in a subject can identify carried work rather than
another landing. Each row links both the canonical PR and its landing commit.
Descriptions summarize published commit subjects and PR titles; they are not
new audits of the underlying changes.

Counts are reproducible with `git rev-list --first-parent --count A..B`.
Release content ranges have separate boundaries from the landing inventory;
they must not be added to the 60-landings total. Publication times come from
GitHub release objects; release SHAs agree with the fetched tags and successful
workflow heads. A tag's date suffix is not its UTC publication date.

This is a closed historical record under [the devlog policy](../../README.md),
consistent with the merged records [#6250](https://github.com/lidge-jun/opencodex/pull/6250)
and [#6031](https://github.com/lidge-jun/opencodex/pull/6031). It does not close or move the other units
listed in the landing inventory, some of which still live under `_plan/`.

Per-PR head/author/CI scorecards, merge-time CI verdicts, coordinator or
administrator causality, and moving fork-tip comparisons are outside this
record. Later check results do not establish what was known at merge time.
Successful release or candidate CI is not proof of every individual PR's
merge-time checks. No npm registry state, dist-tag or npm `gitHead` claim is made.
