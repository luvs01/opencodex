"""Reproduce pinned, reviewed public source; never run dependencies or repository hooks."""
from pathlib import Path
import base64
import gzip
import hashlib
import json
import os
import subprocess

PARENT = "76d7452afb38fd7cc5d9ff7fa4d573b06a9507e3"
DEV = "cfdf5c3795da41ec22bc4b754645f685cdc1d0c6"
BASE_TREE = "d6b54b0b004fd95a10d8860fd04ac06a9f75f615"
TREE = "8620418485e7498b4f91d392839cfeecf95ff9a0"
HEAD = "d624a5c8aee65c10a00a883975f7703108b7a28b"
PATCH_SHA = "b3d128acacd4436b3d0c2dd970674cfef8773cdec0791fca162fbc9fd929e7bb"
MESSAGE = "feat(responses): add bounded native tool-result injection\n\nFollow up #4782 with explicit unsupported control errors, single-owner injection acknowledgements, FIFO and deadline bounds, committed-only replay, and official API beta forwarding. Keep both native controls opt-in and distinct; do not retry tools or relax authentication.\n"
EXPECTED = ["157ca2a8ec5eba48c8ac5b401b616c17bac70286", "f589801b0151d533d0842f59cb92665b15bf68d4", "03a43fb1da097639df0c6d53c46fac146900a4f2", "d0ee2c742f52b25548c3ac9d170e510c7b1b77c6", "f91e5c9a59d357672c464c180eeca40568a3fe89"]
# Correct two verified text-transfer typos only after checking their exact bad blobs.
REPAIRS = {
    1: ("118faf0a676e0e433e911e19c0cff6294b1356d9", b"IEgrFo2zBfEH4sujFqox1Yo", b"IEgrFo2zBfEH4sujjFqox1Yo"),
    4: ("de129dfca559cce8d8d930974a3db29e8c2bbd22", b"569+ub97+eb", b"569+Pn97+ub"),
}

def git(*args, **kwargs):
    return subprocess.check_output(["git", *args], **kwargs)

def text(*args):
    return git(*args).decode("utf-8").strip()

def blob(data):
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()

parts = []
for number, expected in enumerate(EXPECTED, 1):
    data = Path(__file__).with_name(f"part{number}.b64").read_bytes().replace(b"\r\n", b"\n")
    if blob(data) != expected and number in REPAIRS:
        old_sha, old, new = REPAIRS[number]
        assert blob(data) == old_sha and data.count(old) == 1, f"Unexpected transfer content in part {number}"
        data = data.replace(old, new)
    assert blob(data) == expected, f"Part {number} differs from locally verified input"
    parts.append(data.strip())
patch = gzip.decompress(base64.b64decode(b"".join(parts), validate=True))
assert hashlib.sha256(patch).hexdigest() == PATCH_SHA
assert text("rev-parse", "HEAD") == PARENT
assert not text("status", "--porcelain", "--untracked-files=no")
git("config", "core.hooksPath", "/dev/null")
git("config", "core.autocrlf", "false")
git("config", "user.name", "luvs01")
git("config", "user.email", "27862058+luvs01@users.noreply.github.com")
if subprocess.run(["git", "cat-file", "-e", DEV + "^{commit}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
    git("fetch", "--no-tags", "--depth=256", "https://github.com/lidge-jun/opencodex.git", DEV)
git("merge", "--no-ff", "--no-commit", DEV)
assert text("write-tree") == BASE_TREE, "Unexpected integration tree or conflict"
git("apply", "--index", "--whitespace=error", "-", input=patch)
assert text("write-tree") == TREE, "Candidate differs from locally verified source"
env = dict(os.environ, GIT_AUTHOR_NAME="luvs01", GIT_COMMITTER_NAME="luvs01", GIT_AUTHOR_EMAIL="27862058+luvs01@users.noreply.github.com", GIT_COMMITTER_EMAIL="27862058+luvs01@users.noreply.github.com", GIT_AUTHOR_DATE="2026-09-17T01:12:00Z", GIT_COMMITTER_DATE="2026-09-17T01:12:00Z")
created = git("commit-tree", TREE, "-p", PARENT, "-p", DEV, input=MESSAGE.encode("utf-8"), env=env).decode().strip()
assert created == HEAD
git("reset", "--hard", HEAD)
git("update-ref", "refs/remotes/upstream/dev", DEV)
git("merge-base", "--is-ancestor", PARENT, HEAD)
git("merge-base", "--is-ancestor", DEV, HEAD)
git("diff", "--check", DEV, HEAD)
files = text("diff", "--name-only", BASE_TREE, TREE).splitlines()
assert len(files) == 43
assert all(p.startswith(("src/", "tests/", "structure/", "docs-site/", "scripts/test-layout/")) for p in files)
assert not text("diff", "--name-only", DEV, HEAD, "--", ".github", "package.json", "bun.lock", "devlog")
out = Path("evidence")
out.mkdir(exist_ok=True)
identity = dict(head=HEAD, tree=TREE, steeringParent=PARENT, upstream=DEV, mergedParentTree=BASE_TREE, patchSHA256=PATCH_SHA, featureFiles=files)
(out / "source-identity.json").write_bytes((json.dumps(identity, indent=2) + "\n").encode())
(out / "feature-only.patch").write_bytes(patch)
(out / "including-parent.patch").write_bytes(git("diff", "--binary", "--full-index", DEV, HEAD))
(out / "feature-stat.txt").write_bytes(git("diff", "--stat", BASE_TREE, TREE))
print(json.dumps(identity, indent=2))
