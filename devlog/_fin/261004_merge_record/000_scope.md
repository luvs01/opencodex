# Merge record 2026-10-03 → 2026-10-04 — scope

Status: DONE — historical record of published work.

This continues [261002_release_merge_record](https://github.com/luvs01/opencodex/blob/567d414ddf1601bf3db175f1c34b4ddffd9cfb84/devlog/_fin/261002_release_merge_record/000_scope.md)
(`carry/pr699-release-merge-record` on luvs01/opencodex at
[`567d414ddf`](https://github.com/luvs01/opencodex/commit/567d414ddf1601bf3db175f1c34b4ddffd9cfb84),
recorded but not yet landed upstream) with the
same method and the same limits, checked against canonical upstream git history,
GitHub pull requests, release objects, tags and Actions runs.

## Fixed boundaries

- Landing window: first-parent range
  `b4616be1e4db9e7178fd28cb19d4c2269abc2ba7..584b92a53`.
  The left endpoint is excluded; it is the right endpoint of the previous record
  ([#6462](https://github.com/lidge-jun/opencodex/pull/6462), dev opened at 2.77.0).
  The right endpoint is included and landed on 2026-10-04 at 14:32 UTC
  ([#6583](https://github.com/lidge-jun/opencodex/pull/6583)).
- Release publication in the window: stable 2.77.0 published 2026-10-04 02:40:47 UTC.
  No preview tag was published for 2.77.0; the round went candidate → stable.
- [Releases](010_releases.md): one release object, one Release run, one dispatch
  candidate CI; the round's full account already lives in the release-stabilization
  unit and is only cross-referenced here.
- [Landings](020_landings.md): 47 first-parent commits, partitioned into
  11 entries recorded here, 35 landings covered by existing documentation units,
  and one release dev-open. These categories are disjoint.

## Method and limits

The landing PR is the final PR number in each upstream first-parent commit
subject, cross-checked against its merged PR's `merge_commit_sha` and `dev`
base. Earlier PR numbers in a subject can identify carried work rather than
another landing. Each row links both the canonical PR and its landing commit.
Descriptions summarize published commit subjects and PR titles; they are not
new audits of the underlying changes.

Counts are reproducible with `git rev-list --first-parent --count A..B`.
Release content ranges have separate boundaries from the landing inventory;
they must not be added to the 47-landings total. Publication times come from
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
