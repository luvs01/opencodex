"""Prepare only public Git objects and an immutable, reviewed source patch."""
import base64
import hashlib
import json
import lzma
import subprocess
from pathlib import Path

PARENT = '7b548ad85e8f2a6af313198fa68a4111003cbb05'
UPSTREAM = 'e18ca246305bd8fc2b266bdb0ff287c6b25f6bd4'
MERGE = '607fae7ad4074405db08cb4242c92819a27b6d6a'
MERGE_TREE = '1406c7e135a0c30e6591269a0c16e5cb6e6b6f88'
HEAD = 'f3dc8eab3b1ac408991f17e0c34503e707f0ce19'
TREE = 'bfbb6e9131cd574d70affeff8575c320f52348d2'
PATCH_SHA = '573d26f1a2677d0bf8aadaaf9e607171d7895e64b4ef918bbfaa6bd3c96d6a04'
MERGE_OBJECT = 'dHJlZSAxNDA2YzdlMTM1YTBjMzBlNjU5MTI2OWEwYzE2ZTVjYjZlNmI2Zjg4CnBhcmVudCA3YjU0OGFkODVlOGYyYTZhZjMxMzE5OGZhNjhhNDExMTAwM2NiYjA1CnBhcmVudCBlMThjYTI0NjMwNWJkOGZjMmIyNjZiZGIwZmYyODdjNmIyNWY2YmQ0CmF1dGhvciBsdXZzMDEgPDI3ODYyMDU4K2x1dnMwMUB1c2Vycy5ub3JlcGx5LmdpdGh1Yi5jb20+IDE3ODk2MjQ0NDEgKzAwMDAKY29tbWl0dGVyIGx1dnMwMSA8Mjc4NjIwNTgrbHV2czAxQHVzZXJzLm5vcmVwbHkuZ2l0aHViLmNvbT4gMTc4OTYyNDQ0MSArMDAwMAoKTWVyZ2UgY3VycmVudCBkZXYgZm9yIHN0ZWVyaW5nIGNvbXBsZXRpb24gaW50ZWdyYXRpb24K'
HEAD_OBJECT = 'dHJlZSBiZmJiNmU5MTMxY2Q1NzRkNzBhZmZlZmY4NTc1YzMyMGY1MjM0OGQyCnBhcmVudCA2MDdmYWU3YWQ0MDc0NDA1ZGIwOGNiNDI0MmM5MjgxOWEyN2I2ZDZhCmF1dGhvciBsdXZzMDEgPDI3ODYyMDU4K2x1dnMwMUB1c2Vycy5ub3JlcGx5LmdpdGh1Yi5jb20+IDE3ODk2MjU4MTcgKzAwMDAKY29tbWl0dGVyIGx1dnMwMSA8Mjc4NjIwNTgrbHV2czAxQHVzZXJzLm5vcmVwbHkuZ2l0aHViLmNvbT4gMTc4OTYyNTgxNyArMDAwMAoKZmVhdChyZXNwb25zZXMpOiBjb21wbGV0ZSBzYWZlIHN0ZWVyaW5nIG92ZXJyaWRlcywgQVBJIHRyYW5zcG9ydCBhbmQgZXhlY3V0YWJsZSBwcm9iZQo='

def git(*args, **kwargs):
    return subprocess.check_output(['git', *args], **kwargs)

def commit_object(encoded, expected):
    actual = git('hash-object', '-t', 'commit', '-w', '--stdin', input=base64.b64decode(encoded, validate=True)).decode().strip()
    assert actual == expected, actual
    git('reset', '--hard', expected)

assert git('rev-parse', 'HEAD').decode().strip() == PARENT
git('config', '--local', 'core.hooksPath', '/dev/null')
git('config', '--local', 'core.autocrlf', 'false')
git('config', '--local', 'user.name', 'luvs01')
git('config', '--local', 'user.email', '27862058+luvs01@users.noreply.github.com')
git('fetch', '--no-tags', '--depth=512', 'https://github.com/lidge-jun/opencodex.git', UPSTREAM)
git('merge', '--no-ff', '--no-commit', UPSTREAM)
assert git('write-tree').decode().strip() == MERGE_TREE
commit_object(MERGE_OBJECT, MERGE)
root = Path(__file__).resolve().parent
encoded = ''.join((root / f'part{i}.b64').read_text(encoding='ascii').strip() for i in range(1, 4))
patch = lzma.decompress(base64.b64decode(encoded, validate=True))
assert hashlib.sha256(patch).hexdigest() == PATCH_SHA
patch_path = Path('.tmp/steering-completion.patch')
patch_path.parent.mkdir(exist_ok=True)
patch_path.write_bytes(patch)
git('apply', '--check', '--unidiff-zero', str(patch_path))
git('apply', '--index', '--unidiff-zero', str(patch_path))
assert git('write-tree').decode().strip() == TREE
git('diff', '--cached', '--check')
commit_object(HEAD_OBJECT, HEAD)
files = git('diff', '--name-only', MERGE, HEAD).decode().splitlines()
assert len(files) == 34
assert not any(name.startswith(('/', '.github/')) or '..' in Path(name).parts for name in files)
# Read exact blob bytes; no platform newline/default-encoding variation in gates.
for name in files:
    Path(name).write_bytes(git('show', f'{HEAD}:{name}'))
git('diff', '--exit-code', HEAD)
git('merge-base', '--is-ancestor', PARENT, HEAD)
git('merge-base', '--is-ancestor', UPSTREAM, HEAD)
evidence = Path('evidence')
evidence.mkdir(exist_ok=True)
identity = dict(head=HEAD, tree=TREE, merge=MERGE, parent=PARENT, upstream=UPSTREAM, patchSha256=PATCH_SHA, files=files)
(evidence / 'source-identity.json').write_text(json.dumps(identity, indent=2), encoding='utf-8')
(evidence / 'followup.patch').write_bytes(git('diff', '--binary', '--full-index', MERGE, HEAD))
print(json.dumps(identity, indent=2))
