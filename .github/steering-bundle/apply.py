"""Fork-only development helper; never included in the feature PR."""
import base64
import hashlib
import lzma
from pathlib import Path
import subprocess

BASE = "45cfb04e9757a5a257ab6290d9f24d2ea0bc7573"
PATCH_HASH = "999bd8032f14a264845dbfb615587597daab30e4daf69d0b9cae8919fee89b6f"
FILES_HASH = "025d11ad1977561a1fa787540d4fec42fc5b1692df964aa6da03de9ec8fd5ffa"

def git(*args):
    return subprocess.check_output(["git", *args])

if git("rev-parse", "HEAD").decode().strip() != BASE:
    raise SystemExit("Pinned upstream base mismatch")
subprocess.run(["git", "diff", "--quiet"], check=True)
subprocess.run(["git", "diff", "--cached", "--quiet"], check=True)
bundle = Path(__file__).resolve().parent
encoded = b"".join((bundle / f"part{i}.b64").read_bytes().strip() for i in (1, 2, 3))
compressed = base64.b64decode(encoded, validate=True)
decoder = lzma.LZMADecompressor(memlimit=128 * 1024 * 1024)
patch = decoder.decompress(compressed, max_length=512 * 1024)
if not decoder.eof or decoder.unused_data or hashlib.sha256(patch).hexdigest() != PATCH_HASH:
    raise SystemExit("Patch integrity check failed; no files were changed")
patch_file = Path("/tmp/astra-native-steering.patch")
patch_file.write_bytes(patch)
subprocess.run(["git", "apply", "--check", "--index", str(patch_file)], check=True)
subprocess.run(["git", "apply", "--index", str(patch_file)], check=True)
files = sorted(git("diff", "--cached", "--name-only").decode().splitlines())
allowed = ("src/", "structure/", "tests/", "docs-site/src/content/docs/")
if len(files) != 38 or any(not (name.startswith(allowed) or name == "scripts/test-layout/layout.json") for name in files):
    raise SystemExit("Patch contains unexpected paths")
manifest = "".join(f"{hashlib.sha256(Path(name).read_bytes()).hexdigest()}  {name}\n" for name in files).encode()
if hashlib.sha256(manifest).hexdigest() != FILES_HASH:
    raise SystemExit("Applied files differ from the locally tested source")
subprocess.run(["git", "diff", "--cached", "--check"], check=True)
print(f"Verified {len(files)} files; patch sha256={PATCH_HASH}; file manifest sha256={FILES_HASH}")
