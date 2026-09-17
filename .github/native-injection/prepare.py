"""Reproduce only the pinned public source and SHA-verified author patch."""
import base64
import hashlib
import json
import lzma
import os
from pathlib import Path
import subprocess

PARENT = "76d7452afb38fd7cc5d9ff7fa4d573b06a9507e3"
UPSTREAM = "7ef3f6745211f4b275098b6cc89f1be5f0439b45"
BASE_TREE = "2469a5b6e8ce5a861ab9223d10dee8879853826d"
TREE = "a8b8bc3421a64aad83c85a0cafad26d0374182f2"
MERGE = "9c411a10480ea04a5d0244024051bae7fa6dbd05"
HEAD = "de600be5f351243492256d8651cd4b2035259d7d"
PATCH_SHA = "150b5dd8cfd17af423f3e6a0c153a05f4660810bfe0ccb06e49bc85eab5e0697"
ENV = dict(os.environ, GIT_AUTHOR_NAME="luvs01", GIT_COMMITTER_NAME="luvs01",
           GIT_AUTHOR_EMAIL="27862058+luvs01@users.noreply.github.com",
           GIT_COMMITTER_EMAIL="27862058+luvs01@users.noreply.github.com",
           GIT_AUTHOR_DATE="2026-09-17T03:00:00Z", GIT_COMMITTER_DATE="2026-09-17T03:00:00Z")

def git(*args, **kwargs):
    return subprocess.check_output(["git", *args], env=ENV, **kwargs)

assert git("rev-parse", "HEAD").decode().strip() == PARENT
# No hooks, application code, dependency scripts or credentials execute here.
git("config", "--local", "core.hooksPath", "/dev/null")
git("config", "--local", "core.autocrlf", "false")
git("fetch", "--no-tags", "--depth=256", "https://github.com/lidge-jun/opencodex.git", UPSTREAM)
git("merge", "--no-ff", "--no-commit", UPSTREAM)
assert git("write-tree").decode().strip() == BASE_TREE
merge = git("commit-tree", BASE_TREE, "-p", PARENT, "-p", UPSTREAM,
            input=b"Merge pinned dev for native injection follow-up\n").decode().strip()
assert merge == MERGE
git("reset", "--hard", merge)
root = Path(__file__).resolve().parent
encoded = "".join((root / f"part{i}.b64").read_text(encoding="ascii").strip() for i in range(1, 6))
patch = lzma.decompress(base64.b64decode(encoded, validate=True))
assert hashlib.sha256(patch).hexdigest() == PATCH_SHA
patch_file = Path(".tmp/native-injection-author.patch")
patch_file.parent.mkdir(exist_ok=True)
patch_file.write_bytes(patch)
git("apply", "--check", "--unidiff-zero", str(patch_file))
git("apply", "--index", "--unidiff-zero", str(patch_file))
assert git("write-tree").decode().strip() == TREE
git("diff", "--cached", "--check")
message = ("feat(responses): relay native multi-agent function-result injection\n\n"
           "Follow up on #4782 with a separate default-off injection owner, bounded serial acknowledgements, "
           "same-account caller continuations, accepted-result replay and regression coverage.\n")
head = git("commit-tree", TREE, "-p", MERGE, input=message.encode()).decode().strip()
assert head == HEAD
git("reset", "--hard", head)
files = git("diff", "--name-only", MERGE, HEAD).decode().splitlines()
assert files and not any(name.startswith(".github/") for name in files)
# Exact Git blob bytes avoid platform text/newline translation in static gates.
for name in files:
    Path(name).write_bytes(git("show", f"{HEAD}:{name}"))
git("diff", "--exit-code", HEAD)
git("merge-base", "--is-ancestor", PARENT, HEAD)
git("merge-base", "--is-ancestor", UPSTREAM, HEAD)
evidence = Path("evidence")
evidence.mkdir(exist_ok=True)
identity = dict(head=HEAD, tree=TREE, merge=MERGE, parent=PARENT, upstream=UPSTREAM,
                patchSha256=PATCH_SHA, files=files)
(evidence / "source-identity.json").write_text(json.dumps(identity, indent=2), encoding="utf-8")
(evidence / "followup.patch").write_bytes(git("diff", "--binary", "--full-index", MERGE, HEAD))
print(json.dumps(identity, indent=2))
