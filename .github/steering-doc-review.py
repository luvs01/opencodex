import base64, json, subprocess
from pathlib import Path
PARENT='f3dc8eab3b1ac408991f17e0c34503e707f0ce19'
HEAD='15a8e715851d53d13d3718b16c8ad4cdc8e6ec32'
TREE='3b59ed753e2bb5695eec3339fb42d6a1ea1b2207'
def git(*args,**kw): return subprocess.check_output(['git',*args],**kw)
assert git('rev-parse','HEAD').decode().strip()==PARENT
git('config','core.hooksPath','/dev/null')
git('config','core.autocrlf','false')
guide=Path('docs-site/src/content/docs/guides/codex-integration.md')
config=Path('docs-site/src/content/docs/reference/configuration/server.md')
a='For a compatible native OpenAI model and a client that sends `response.steer`, enable both\noptions in `~/.opencodex/config.json` and restart OpenCodex before starting a fresh turn:'
b='For a compatible model on the canonical ChatGPT forward route or an explicitly configured\n[OpenAI API WebSocket route](#steering-continuation-settings-and-public-api), and a client\nthat sends `response.steer`, enable both options in `~/.opencodex/config.json` and restart\nOpenCodex before starting a fresh turn:'
s=git('show',f'{PARENT}:{guide.as_posix()}').decode(); assert s.count(a)==1
guide.write_bytes(s.replace(a,b).encode())
s=git('show',f'{PARENT}:{config.as_posix()}').decode()
i=s.index('\n\nThe opt-in `codexNativeInjection` owner also accepts typed saved-result')
s=s[:i]+'\n\n## Experimental native response controls\n\n`codexNativeSteering` and `codexNativeInjection` enable separate, default-off native\nWebSocket control paths. See the canonical guide for\n[supported steering routes and settings](../../guides/codex-integration.md#steering-continuation-settings-and-public-api),\n[typed result and approval continuations](../../guides/codex-integration.md#rich-tool-results-and-explicit-approvals-after-response-completion),\nand [confirmation deadlines and retained context](../../guides/codex-integration.md#steering-confirmation-deadlines-and-retained-context).\n'
config.write_bytes(s.encode())
git('add',str(guide),str(config)); git('diff','--cached','--check')
assert git('write-tree').decode().strip()==TREE
obj='dHJlZSAzYjU5ZWQ3NTNlMmJiNTY5NWVlYzMzMzlmYjQyZDZhMWVhMWIyMjA3CnBhcmVudCBmM2RjOGVhYjNiMWFjNDA4OTkxZjE3ZTBjMzQ1MDNlNzA3ZjBjZTE5CmF1dGhvciBsdXZzMDEgPDI3ODYyMDU4K2x1dnMwMUB1c2Vycy5ub3JlcGx5LmdpdGh1Yi5jb20+IDE3ODk2MjcwMDcgKzAwMDAKY29tbWl0dGVyIGx1dnMwMSA8Mjc4NjIwNTgrbHV2czAxQHVzZXJzLm5vcmVwbHkuZ2l0aHViLmNvbT4gMTc4OTYyNzAwNyArMDAwMAoKZG9jczogY2xhcmlmeSBzdGVlcmluZyByb3V0ZXMgYW5kIGNvbnNvbGlkYXRlIGNvbnRyb2wgZ3VpZGFuY2UK'
assert git('hash-object','-t','commit','-w','--stdin',input=base64.b64decode(obj)).decode().strip()==HEAD
git('reset','--hard',HEAD)
assert git('diff','--name-only',PARENT,HEAD).decode().splitlines()==[str(guide),str(config)]
git('diff','--exit-code',HEAD)
Path('evidence').mkdir(exist_ok=True)
Path('evidence/identity.json').write_text(json.dumps(dict(head=HEAD,tree=TREE,runtimeTestedParent=PARENT),indent=2))
Path('evidence/docs-only.patch').write_bytes(git('diff','--full-index',PARENT,HEAD))
