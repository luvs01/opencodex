# 060 — wave: 10-01 night Windows service/update

Seven merges 10-01 23:51 → 10-02 00:46 UTC. Six are the devin-ai-integration bot's
Windows service/update fixes (guarded stop, takeover budget, scheduler probes,
updater/restart leases — the #5760 restart-lease work), all merged with
`enforce-target` red on bot heads; #6419 is the maintainer's CLI-picker repair.
Wave-mate #6418 (Claude CLI first-party picker) has its own unit.

## PRs

| PR | Author | Head → squash | ci | et | Change |
|---|---|---|---|---|---|
| #6403 | devin-ai-integration | `e6bf0bae` → `89db85ff05` | ✓ | ✗ | bound every Windows manager command the guarded stop depends on |
| #6400 | devin-ai-integration | `bd5c085c` → `137164e3eb` | ✓ | ✗ | Windows guarded takeover finishes within one bounded budget |
| #6407 | devin-ai-integration | `dc10a269` → `17d6e8498d` | ✓ | ✗ | release the Bun updater lease around service-manager starts (#5760) |
| #6401 | devin-ai-integration | `914c0524` → `cfde167436` | ✓ | ✗ | scope scheduler probes to root task, re-probe deleted registrations |
| #6404 | devin-ai-integration | `e7a59053` → `0f2ec7adb0` | ✓ | ✗ | release the restart lease before the service refresh (#5760) |
| #6402 | devin-ai-integration | `e419c711` → `6d84e4468d` | ✓ | ✗ | stabilize guarded-stop re-verification, report the failing guard fact |
| #6419 | lidge-jun | `fa2e493f` → `8b23fe340a` | ✓ | ✓ | rebuild a CLI picker snapshot whose rows no longer decode |
