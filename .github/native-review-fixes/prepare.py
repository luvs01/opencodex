"""Reconstruct immutable reviewed Git trees; never execute application code."""
import base64, hashlib, json, lzma, subprocess, sys
from pathlib import Path

STAGES = {
    '4858': ('95363c18561a27e4b8fd363be5d6d9e10e74c332', '10178a442c3b9f755125936ff002b16907740f0d'),
    '4861': ('c409433615bcb6e107de95293f437c8f296e4310', 'a7f53c3339ba44f086410d93fb826f6fe8d6e325'),
    '4864': ('6f522b49d0ce1ec1fff25719d2223d289f2fcd96', '920c19162f7dc175e8df3d91418e73914d350783'),
}
OLD = ['7a9a6d28dd8680cce890e06813e4a08796624d0a', '59a1d6357e018d44104a50b1126350b72368c81d', '7b548ad85e8f2a6af313198fa68a4111003cbb05']

def git(*args, **kwargs):
    return subprocess.check_output(['git', *args], **kwargs)

def text(*args):
    return git(*args).decode().strip()

stage = sys.argv[1]
assert stage in STAGES
assert text('rev-parse', 'HEAD') == OLD[0]
git('config', '--local', 'core.hooksPath', '/dev/null')
git('config', '--local', 'core.autocrlf', 'false')
for sha in OLD[1:]:
    git('fetch', '--no-tags', '--depth=256', 'https://github.com/luvs01/opencodex.git', sha)
root = Path(__file__).resolve().parent
encoded = ''.join((root / f'part{i}.b64').read_text(encoding='ascii').strip() for i in (1, 2))
raw = lzma.decompress(base64.b64decode(encoded, validate=True))
assert hashlib.sha256(raw).hexdigest() == 'c9076154a88a9f47fcf2e0b78ef500b740a5e5869098006225b5675879605545'
records = json.loads(raw)
assert len(records) == 7
patch = Path('.tmp/native-review.patch')
patch.parent.mkdir(exist_ok=True)
for entry in records:
    git('read-tree', '--reset', '-u', entry['base'])
    patch.write_bytes(entry['patch'].encode())
    git('apply', '--check', '--unidiff-zero', str(patch))
    git('apply', '--index', '--unidiff-zero', str(patch))
    tree = entry['meta'].splitlines()[0].removeprefix('tree ')
    assert text('write-tree') == tree
    created = git('hash-object', '-t', 'commit', '-w', '--stdin', input=entry['meta'].encode()).decode().strip()
    assert created == entry['sha']
head, tree = STAGES[stage]
git('reset', '--hard', head)
assert text('rev-parse', 'HEAD^{tree}') == tree
for parent, child in [('4858', '4861'), ('4861', '4864')]:
    git('merge-base', '--is-ancestor', STAGES[parent][0], STAGES[child][0])
# All rebased author commits remain in order. Do not carry a later-stage feature backward.
files = text('diff', '--name-only', OLD[0], head).splitlines()
assert files and not any(name.startswith('.github/') for name in files)
for name in files:
    Path(name).write_bytes(git('show', head + ':' + name))
git('diff', '--exit-code', 'HEAD')
git('diff', '--check', OLD[0], head)
evidence = Path('evidence')
evidence.mkdir(exist_ok=True)
identity = dict(stage=stage, head=head, tree=tree, oldHeads=OLD, stages=STAGES, files=files)
(evidence / 'source-identity.json').write_text(json.dumps(identity, indent=2), encoding='utf-8')
(evidence / 'review-fixes.patch').write_bytes(git('diff', '--binary', '--full-index', OLD[0], head))
print(json.dumps(identity, indent=2))
