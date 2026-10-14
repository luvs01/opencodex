"""Publish only two new refs whose complete trees match the locally checked candidates."""
import base64, hashlib, json, os, subprocess, tempfile, zlib
from pathlib import Path

BASE = 'f5f73ff3970b3b238c4e2fade29ba3f64914f637'
BASE_TREE = 'f086f6e5891a222bd541b1aa64f414c001263650'
REPO = 'luvs01/opencodex'
AUX = 'refs/heads/codex/security-audit-source-20261014'
if os.environ.get('GITHUB_REPOSITORY') != REPO or os.environ.get('GITHUB_REF') != AUX:
    raise RuntimeError('Unexpected publication context')
folder = Path('scripts/security-followup-20261014')
encoded = (folder/'oauth.patch.b64').read_bytes().strip()
if len(encoded) != 7560:
    raise RuntimeError('OAuth transfer length mismatch')
decoder = zlib.decompressobj()
oauth = decoder.decompress(base64.b64decode(encoded, validate=True), 19056)
if not decoder.eof or decoder.unconsumed_tail or decoder.unused_data or len(oauth) != 19055:
    raise RuntimeError('OAuth envelope mismatch')
if hashlib.sha256(oauth).hexdigest() != '29c3114703cc578f881c57e1d509c96ccc464f37f71887d25b5ff0a5cfc63abf':
    raise RuntimeError('OAuth patch checksum mismatch')
picker = (folder/'picker-core.patch').read_bytes()
if len(picker) != 9607 or hashlib.sha256(picker).hexdigest() != 'c4a1f2fa83c0774a2d0393ae06802138f89770fb4bab74524d7ba7eea9230683':
    raise RuntimeError('Picker patch checksum mismatch')
docs = json.loads((folder/'picker-docs.json').read_text(encoding='utf8'))
if set(docs) != {'en','ko','ja','fr','ru','tr','zh-cn','zh-tw'} or any(not isinstance(v,str) or len(v)>2000 for v in docs.values()):
    raise RuntimeError('Unexpected documentation scope')
plans = [
    ('codex/fix-oauth-refresh-consumers-20261014', oauth, '080372791545407b96f6a0a4c204e445452a9553',
     {'src/oauth/index.ts','src/server/responses/request-transport.ts','tests/oauth/oauth-refresh-generic-lock.test.ts','structure/runtime.md'},
     'fix(oauth): bound unresolved refresh consumers independently of turns'),
    ('codex/fix-picker-upload-idle-only-20261014', picker, '49809e3c15c7a76d44934f7df24012cf74c68aa1',
     {'src/claude/intercept/picker-listener.ts','tests/claude-integration/claude-picker-upload.test.ts','structure/clients/claude-desktop.md'},
     'fix(claude): expire idle picker uploads without a lifetime cap'),
]
env = dict(os.environ)
env.update(GIT_CONFIG_COUNT='1', GIT_CONFIG_KEY_0='http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0='AUTHORIZATION: basic '+base64.b64encode(('x-access-token:'+env['GH_TOKEN']).encode()).decode(),
    GIT_AUTHOR_NAME='github-actions[bot]', GIT_COMMITTER_NAME='github-actions[bot]',
    GIT_AUTHOR_EMAIL='41898282+github-actions[bot]@users.noreply.github.com',
    GIT_COMMITTER_EMAIL='41898282+github-actions[bot]@users.noreply.github.com')
def git(*args, data=None, use_env=None):
    p = subprocess.run(['git',*args], input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=use_env or env)
    if p.returncode:
        raise RuntimeError('git '+args[0]+' failed: '+p.stderr.decode(errors='replace'))
    return p.stdout.decode().strip()
if git('remote','get-url','origin') not in ('https://github.com/'+REPO, 'https://github.com/'+REPO+'.git'):
    raise RuntimeError('Unexpected remote')
git('fetch','--no-tags','--depth=1','origin',BASE)
if git('rev-parse',BASE+'^{tree}') != BASE_TREE:
    raise RuntimeError('Unexpected base tree')
for branch, *_ in plans:
    if git('ls-remote','--heads','origin','refs/heads/'+branch):
        raise RuntimeError('Target exists; refusing overwrite: '+branch)
commits=[]
for branch, patch, expected, paths, message in plans:
    with tempfile.TemporaryDirectory(prefix='ocx-candidate-index-') as td:
        indexed={**env,'GIT_INDEX_FILE':str(Path(td)/'index')}
        git('read-tree',BASE,use_env=indexed)
        git('apply','--cached','--check','--whitespace=error-all','-',data=patch,use_env=indexed)
        git('apply','--cached','--whitespace=error-all','-',data=patch,use_env=indexed)
        paths=set(paths)
        if branch.endswith('idle-only-20261014'):
            for lang, para in docs.items():
                path='docs-site/src/content/docs/'+('' if lang=='en' else lang+'/')+'guides/claude-code.md'
                raw=subprocess.run(['git','show',BASE+':'+path],check=True,stdout=subprocess.PIPE,env=env).stdout
                text=raw.decode('utf8')
                headers=[line for line in text.splitlines() if line.startswith('### ') and 'picker' in line.lower()]
                if not headers or para in text: raise RuntimeError('Documentation anchor mismatch')
                start=text.index(headers[0]); end=text.find('\n### ',start+len(headers[0]))
                if end<=start: raise RuntimeError('Documentation section boundary missing')
                updated=text[:end].rstrip()+'\n\n'+para+'\n'+text[end:]
                blob=git('hash-object','-w','--stdin',data=updated.encode('utf8'))
                git('update-index','--add','--cacheinfo','100644,'+blob+','+path,use_env=indexed)
                paths.add(path)
        git('diff','--cached','--check',BASE,use_env=indexed)
        if set(git('diff','--cached','--name-only',BASE,use_env=indexed).splitlines()) != paths:
            raise RuntimeError('Unexpected changed-file scope')
        tree=git('write-tree',use_env=indexed)
        if tree != expected: raise RuntimeError('Candidate tree mismatch: '+branch+' '+tree)
        commit=git('commit-tree',tree,'-p',BASE,data=(message+'\n\nPublish the exact locally tested candidate tree. See the draft PR for\nfocused validation, remaining native/operational coverage and acceptance holds.\n').encode())
        commits.append((branch,commit,tree))
# Neither existing integration refs nor contributor branches are changed.
git('push','--atomic','origin',*(commit+':refs/heads/'+branch for branch,commit,_ in commits))
for branch,commit,tree in commits:
    print(json.dumps({'branch':branch,'commit':commit,'tree':tree}))
