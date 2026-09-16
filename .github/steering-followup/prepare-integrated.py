"""Deterministically prepare the reviewed feature plus the current upstream base.
No dependencies, repository hooks or application code execute in this script.
"""
from pathlib import Path
import json
import os
import subprocess
import sys

UPSTREAM = "b3035fe292168bc598b5d67e77203e2b65404578"
CANDIDATE = "978b27c2478e5dabc93829a1d920b84a09614fae"
EVIDENCE = Path("evidence")
EVIDENCE.mkdir(exist_ok=True)
env = dict(os.environ, GIT_AUTHOR_DATE="2026-09-16T02:45:00Z", GIT_COMMITTER_DATE="2026-09-16T02:45:00Z")

def run(*args, **kwargs):
    return subprocess.run(list(args), check=True, env=env, **kwargs)

def git(*args):
    return subprocess.check_output(["git", *args], env=env).decode().strip()

run(sys.executable, str(Path(__file__).with_name("apply.py")))
assert git("write-tree") == "613b00d1c359e212c62bae519c134e02d0dafe42", "validated follow-up tree mismatch"
# Register the newly reachable owners in the source-oracle inventory. This
# expands coverage; the graph equality and physical-line guards stay unchanged.
p = Path("tests/helpers/responses-core-source.ts")
text = p.read_text()
needle = '  "core-options.ts",'
assert text.count(needle) == 1 and '  "native-steering.ts",' not in text
text = text.replace(needle, needle + '\n  "native-steering.ts",\n  "native-steering-replay.ts",\n  "codex-ws-correlation.ts",')
p.write_text(text)
run("git", "add", "tests/helpers/responses-core-source.ts")
run("git", "config", "user.name", "luvs01")
run("git", "config", "user.email", "27862058+luvs01@users.noreply.github.com")
run("git", "config", "core.hooksPath", "/dev/null")
run("git", "commit", "-m", "fix(responses): preserve steering continuations and register bounded owners")
assert git("rev-parse", "HEAD^") == CANDIDATE
run("git", "fetch", "--no-tags", "--depth=64", "https://github.com/lidge-jun/opencodex.git", UPSTREAM)
try:
    run("git", "merge", "--no-ff", "--no-edit", UPSTREAM, "-m", "Merge current upstream dev for native steering integration verification")
except subprocess.CalledProcessError:
    (EVIDENCE / "conflicts.txt").write_text(git("diff", "--name-only", "--diff-filter=U"))
    (EVIDENCE / "merge-conflict.diff").write_bytes(subprocess.check_output(["git", "diff"]))
    raise
run("git", "merge-base", "--is-ancestor", UPSTREAM, "HEAD")
run("git", "merge-base", "--is-ancestor", CANDIDATE, "HEAD")
run("git", "diff", "--check", UPSTREAM, "HEAD")
files = git("diff", "--name-only", UPSTREAM, "HEAD").splitlines()
assert all(name.startswith(("src/", "tests/", "scripts/test-layout/", "structure/", "docs-site/")) for name in files), "unrelated file entered feature diff"
assert not any(name.startswith((".github/", "assets/", "devlog/")) for name in files)
identity = {"head": git("rev-parse", "HEAD"), "tree": git("rev-parse", "HEAD^{tree}"), "upstream": UPSTREAM, "originalCandidate": CANDIDATE, "files": files}
(EVIDENCE / "source-identity.json").write_text(json.dumps(identity, indent=2) + "\n")
(EVIDENCE / "candidate.patch").write_bytes(subprocess.check_output(["git", "diff", "--binary", UPSTREAM, "HEAD"]))
(EVIDENCE / "diff-stat.txt").write_text(git("diff", "--stat", UPSTREAM, "HEAD") + "\n")
print(json.dumps(identity, indent=2))
