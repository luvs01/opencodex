"""Reproduce the reviewed extension from a pinned parent and checked public patch."""
import hashlib
import json
import lzma
import os
from pathlib import Path
import subprocess

PARENT = "de600be5f351243492256d8651cd4b2035259d7d"
HEAD = "b00654b368772f08c3bc68ce84b57fafc6305bc8"
TREE = "91ddb6c20a267d0027ba7187c7dc92ccd130051d"
PATCH = "834789082a1bb6d6cbb0639f598bdc614dd747f0dd6ce928e216dcb2e04cac0c"
PACKED = "61a191679b4570df0d19de01b0295947a32bec6c81261038f33a2b30c48d2bed"
MESSAGE = ("feat(responses): support typed native result continuations and preserve hosted output\n\n"
           "Extend #4858 with rich/custom results and explicit approval continuations, execution-mode selection, "
           "structural replay matching and lossless sparse-terminal reconciliation. Keep unsupported inject and mixed-mode operations fail-closed.\n")
ENV = dict(os.environ, GIT_AUTHOR_NAME="luvs01", GIT_COMMITTER_NAME="luvs01",
           GIT_AUTHOR_EMAIL="27862058+luvs01@users.noreply.github.com",
           GIT_COMMITTER_EMAIL="27862058+luvs01@users.noreply.github.com",
           GIT_AUTHOR_DATE="2026-09-17T04:30:00Z", GIT_COMMITTER_DATE="2026-09-17T04:30:00Z")

def git(*args, **kwargs):
    return subprocess.check_output(["git", *args], env=ENV, **kwargs)

assert git("rev-parse", "HEAD").decode().strip() == PARENT
git("config", "--local", "core.hooksPath", "/dev/null")
git("config", "--local", "core.autocrlf", "false")
packed = Path(__file__).with_name("extension.patch.xz").read_bytes()
assert hashlib.sha256(packed).hexdigest() == PACKED
patch = lzma.decompress(packed)
assert hashlib.sha256(patch).hexdigest() == PATCH
file = Path(".tmp/native-result-extension.patch")
file.parent.mkdir(exist_ok=True)
file.write_bytes(patch)
git("apply", "--check", "--unidiff-zero", str(file))
git("apply", "--index", "--unidiff-zero", str(file))
assert git("write-tree").decode().strip() == TREE
git("diff", "--cached", "--check")
head = git("commit-tree", TREE, "-p", PARENT, input=MESSAGE.encode()).decode().strip()
assert head == HEAD, head
git("reset", "--hard", head)
files = git("diff", "--name-only", PARENT, HEAD).decode().splitlines()
assert len(files) == 27 and not any(name.startswith(".github/") for name in files)
# Inspect actual Git blob bytes, not a platform's temporary text translation.
for name in files:
    Path(name).write_bytes(git("show", f"{HEAD}:{name}"))
git("diff", "--exit-code", HEAD)
git("merge-base", "--is-ancestor", PARENT, HEAD)
evidence = Path("evidence")
evidence.mkdir(exist_ok=True)
identity = dict(head=HEAD, parent=PARENT, tree=TREE, patchSha256=PATCH, packedSha256=PACKED, files=files)
(evidence / "source-identity.json").write_text(json.dumps(identity, indent=2), encoding="utf-8")
(evidence / "extension.patch").write_bytes(git("diff", "--binary", "--full-index", PARENT, HEAD))
print(json.dumps(identity, indent=2))
