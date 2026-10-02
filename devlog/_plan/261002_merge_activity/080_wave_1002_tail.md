# 080 — wave: 10-02 tail

Two merges after the 13:14 UTC cutoff of files 040–070: the OpenGateway preset
feature, then the 2.77.0 dev-open that is release machinery for the 2.76.0 round
(035). Upstream `dev` tip is now `b4616be1e4`; this fork's `dev` trails it by two
squash merges (#6448, #6462).

## PRs

| PR | Author | Head → squash | ci | et | Change |
|---|---|---|---|---|---|
| #6448 | lidge-jun | `ef7508e1` → `e0af52c8a2` | ✓ | ✓ | OpenGateway (Sionic AI) built-in key preset `opengateway`, live model refresh |
| #6462 | github-actions[bot] | `b95041c2` → `b4616be1e4` | ✓ | ✗ | chore(release): open dev at 2.77.0 — release machinery, recorded in 035 |

`et:✗` on #6462 is the `enforce-target` conclusion on a bot-authored head, not a
required check.
