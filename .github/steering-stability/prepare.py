"""Reconstruct the reviewed public patch without executing application code."""
import hashlib
import json
import lzma
import os
from pathlib import Path
import subprocess

PARENT = 'b00654b368772f08c3bc68ce84b57fafc6305bc8'
PARENT_TREE = '91ddb6c20a267d0027ba7187c7dc92ccd130051d'
TREE = '044b8eee5c08d327ef1f0697a766d05ed93bf2bb'
HEAD = '7b548ad85e8f2a6af313198fa68a4111003cbb05'
PATCH_SHA = '6cc5fb180b6524c94044369a57af0644fc4fc39ea0c6e239ea3e6142e39526d4'
PACKED_SHA = '8d445b81e0ca6e25f96324c7cbe993d0fd936c30f4f5cccfa090551cc9dd85f6'
MESSAGE = 'fix(responses): bound steering confirmation waits and preserve sparse replay output\n\nSeparate monotonic acknowledgement, successor and tool deadlines; reconcile steering replay with completed wire items without weakening ownership or retry guards. Follow up on #4861.\n'
ENV = dict(os.environ, GIT_AUTHOR_NAME='luvs01', GIT_COMMITTER_NAME='luvs01',
           GIT_AUTHOR_EMAIL='27862058+luvs01@users.noreply.github.com',
           GIT_COMMITTER_EMAIL='27862058+luvs01@users.noreply.github.com',
           GIT_AUTHOR_DATE='2026-09-17T05:13:13+00:00', GIT_COMMITTER_DATE='2026-09-17T05:13:13+00:00')

def git(*args, **kwargs):
    return subprocess.check_output(['git', *args], env=ENV, **kwargs)

assert git('rev-parse', 'HEAD').decode().strip() == PARENT
assert git('rev-parse', 'HEAD^{tree}').decode().strip() == PARENT_TREE
git('config', '--local', 'core.hooksPath', '/dev/null')
git('config', '--local', 'core.autocrlf', 'false')
packed = (Path(__file__).resolve().parent / 'patch.xz').read_bytes()
assert len(packed) == 10384 and hashlib.sha256(packed).hexdigest() == PACKED_SHA
patch = lzma.decompress(packed)
assert len(patch) == 43046 and hashlib.sha256(patch).hexdigest() == PATCH_SHA
path = Path('.tmp/steering-stability.patch')
path.parent.mkdir(exist_ok=True)
path.write_bytes(patch)
git('apply', '--check', '--unidiff-zero', str(path))
git('apply', '--index', '--unidiff-zero', str(path))
git('diff', '--cached', '--check')
assert git('write-tree').decode().strip() == TREE
files = git('diff', '--cached', '--name-only').decode().splitlines()
assert len(files) == 25 and not any(name.startswith('.github/') for name in files)
head = git('commit-tree', TREE, '-p', PARENT, input=MESSAGE.encode()).decode().strip()
assert head == HEAD, head
git('reset', '--hard', head)
# Use committed bytes, not platform newline conversion, for source-oracle checks.
for name in files:
    Path(name).write_bytes(git('show', f'{HEAD}:{name}'))
git('diff', '--exit-code', HEAD)
git('merge-base', '--is-ancestor', PARENT, HEAD)
evidence = Path('evidence')
evidence.mkdir(exist_ok=True)
identity = dict(head=HEAD, tree=TREE, parent=PARENT, parentTree=PARENT_TREE,
                patchSha256=PATCH_SHA, packedSha256=PACKED_SHA, files=files)
(evidence / 'source-identity.json').write_text(json.dumps(identity, indent=2), encoding='utf-8')
(evidence / 'steering-stability.patch').write_bytes(git('diff', '--binary', '--full-index', PARENT, HEAD))
print(json.dumps(identity, indent=2))
