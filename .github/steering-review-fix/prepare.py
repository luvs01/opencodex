"""Reproduce the reviewed PR tree from pinned public Git data and a checked patch.
No application code, dependencies or repository hooks execute in this preparer.
"""
from pathlib import Path
import base64
import hashlib
import json
import os
import re
import subprocess
import zlib

OLD = '5cfc0c8795e128c2876aa20d75dbf3644fe65687'
BASE = 'b3035fe292168bc598b5d67e77203e2b65404578'
UPSTREAM = 'ada3a9b1b5fdac1fd47dfede0bbab4ef3ca4c6aa'
BASE_TREE = '5a2dda715e8e63b5fab24df6183b2fdc5961ec9f'
TREE = '7f53b35f2a90dccc311cebef7e82dea0ac860d3c'
HEAD = 'e9621393f0cd8b02636bac82b538a7ab419fe283'
PATCH_SHA = '01c1a0171b0686c8e701b9e78d7619e74ebe4932fb0203f1f6027223b35b8ea4'
MESSAGE = ('fix(responses): address native steering review and sync dev\n\n'
 'Clear unstarted and superseded channel ownership, append bounded replay without argument spreading, and add six red-to-green regressions. Consolidate architecture notes into short links and document native control helpers. Preserve both sides of four documentation conflicts with current dev.\n')
env = dict(os.environ, GIT_AUTHOR_NAME='luvs01', GIT_COMMITTER_NAME='luvs01',
 GIT_AUTHOR_EMAIL='27862058+luvs01@users.noreply.github.com',
 GIT_COMMITTER_EMAIL='27862058+luvs01@users.noreply.github.com',
 GIT_AUTHOR_DATE='2026-09-16T09:10:21Z', GIT_COMMITTER_DATE='2026-09-16T09:10:21Z')

def git(*args, input=None):
    return subprocess.check_output(['git', *args], input=input, env=env)

def text(*args):
    return git(*args).decode('utf-8').strip()

assert text('rev-parse', 'HEAD') == OLD
# Use an empty hooks directory only in this disposable verification checkout.
hooks = Path('.git/review-empty-hooks'); hooks.mkdir(exist_ok=True)
git('config', 'core.hooksPath', str(hooks.resolve()))
git('fetch', '--no-tags', '--depth=128', 'https://github.com/lidge-jun/opencodex.git', UPSTREAM)
merged = subprocess.run(['git', 'merge', '--no-ff', '--no-commit', UPSTREAM], env=env)
conflicts = text('diff', '--name-only', '--diff-filter=U').splitlines()
expected = ['structure/providers/chat-compat.md', 'structure/runtime.md', 'structure/transports/byte-accounting.md', 'structure/transports/responses.md']
assert merged.returncode == 1 and conflicts == expected, conflicts
for name in conflicts:
    original = git('show', f'{OLD}:{name}').decode('utf-8')
    match = re.search(r'\nThe opt-in \[native mid-turn steering contract\][\s\S]*$', original)
    assert match is not None, name
    note = match.group(0)
    assert original[:match.start()].rstrip() == git('show', f'{BASE}:{name}').decode('utf-8').rstrip(), name
    upstream = git('show', f'{UPSTREAM}:{name}').decode('utf-8')
    Path(name).write_bytes((upstream.rstrip() + '\n' + note).encode('utf-8'))
git('add', '--', *conflicts)
assert text('write-tree') == BASE_TREE, text('write-tree')
root = Path(__file__).parent
encoded = ''.join((root / f'part{i}.b64').read_text(encoding='utf-8').strip() for i in range(1, 4))
assert len(encoded) == 14696
stream = zlib.decompressobj()
patch = stream.decompress(base64.b64decode(encoded, validate=True), 100_001)
assert stream.eof and not stream.unused_data and len(patch) < 100_000
assert hashlib.sha256(patch).hexdigest() == PATCH_SHA
git('apply', '--index', '--check', '-', input=patch)
git('apply', '--index', '-', input=patch)
assert text('write-tree') == TREE, text('write-tree')
head = git('commit-tree', TREE, '-p', OLD, '-p', UPSTREAM, input=MESSAGE.encode('utf-8')).decode().strip()
assert head == HEAD, head
# This is a disposable checkout; reset clears the temporary merge bookkeeping.
git('reset', '--hard', head)
git('diff', '--check', UPSTREAM, head)
files = text('diff', '--name-only', UPSTREAM, head).splitlines()
assert len(files) == 40
assert all(p.startswith(('src/', 'tests/', 'structure/', 'docs-site/', 'scripts/test-layout/')) for p in files)
assert not any(p.startswith(('.github/', 'devlog/', 'assets/')) for p in files)
# Verify the actual two text files written during preparation remain byte exact,
# including on Windows. Do not normalize or weaken any repository checker.
for name in ['structure/runtime.md', 'tests/helpers/responses-core-source.ts']:
    Path(name).write_bytes(git('show', f'{HEAD}:{name}'))
git('diff', '--exit-code', HEAD)
evidence = Path('evidence'); evidence.mkdir(exist_ok=True)
identity = {'head': head, 'tree': TREE, 'upstream': UPSTREAM, 'previousHead': OLD, 'files': files}
(evidence / 'source-identity.json').write_bytes((json.dumps(identity, indent=2) + '\n').encode())
(evidence / 'candidate.patch').write_bytes(git('diff', '--binary', UPSTREAM, HEAD))
(evidence / 'diff-stat.txt').write_bytes(git('diff', '--stat', UPSTREAM, HEAD))
print(json.dumps(identity, indent=2))
