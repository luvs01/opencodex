"""Apply the reviewed seven-file follow-up, never stage the transport bundle."""
from pathlib import Path
import base64
import gzip
import hashlib
import subprocess

BASE = "978b27c2478e5dabc93829a1d920b84a09614fae"
PATCH_SHA = "3c3e5ea002f828f0eafb55e976fe5cc8d6ec41c9cd9c495acac1cc2051713587"
EXPECTED = {
    "docs-site/src/content/docs/guides/codex-integration.md": "1f4c04f5363ee4c9561805acff13291b709808bf1b671cdc0d75be72f320adef",
    "src/responses/state.ts": "b783959c6281f7098552b27d9b7b220a018ebe6b7bf8ba493708548d65631b27",
    "src/responses/state/body-policy.ts": "a0210597f6930d9ccc8bdb5616ec84cf72f7a6f733ac3128c27650ff31ebd82e",
    "src/server/responses/codex-ws-exchange.ts": "e03e470ac68ed34944d040eba2a2d6be51a230419b72c8722d454705cfb238fb",
    "src/server/responses/native-steering.ts": "adc51c1d74234d0cc07c230a1066fd72bdff44019cb7952c762422bf0a8ff0fa",
    "structure/transports/streaming-health.md": "e2b351c06be2b5362ade6d016634386ced1c1d305227f616ef67df159e54eca3",
    "tests/responses/ws-native-steering.test.ts": "9c589811843c827c478bf3be92aa6272505e9694c897498267f39721907150cf",
}

def git(*args):
    return subprocess.check_output(["git", *args]).decode().strip()

assert git("rev-parse", "HEAD") == BASE, "candidate base moved"
encoded = Path(__file__).with_name("patch.b64").read_text().strip()
# Repair one known connector-input transcription before verifying the original
# local patch hash. The hash below remains the authority; no fuzzy git apply.
encoded = encoded.replace("B+JdrG+uizEYE", "B+JdrG+izEYE")
assert len(encoded) == 9360, "unexpected encoded bundle length"
patch = gzip.decompress(base64.b64decode(encoded, validate=True))
assert len(patch) == 25018 and hashlib.sha256(patch).hexdigest() == PATCH_SHA, "patch integrity mismatch"
subprocess.run(["git", "apply", "--check", "--index", "-"], input=patch, check=True)
subprocess.run(["git", "apply", "--index", "-"], input=patch, check=True)
assert set(git("diff", "--cached", "--name-only").splitlines()) == set(EXPECTED), "unexpected staged paths"
for name, digest in EXPECTED.items():
    assert hashlib.sha256(Path(name).read_bytes()).hexdigest() == digest, name
subprocess.run(["git", "diff", "--cached", "--check"], check=True)
print("Verified seven-file patch", PATCH_SHA)
print("Verified candidate tree", git("write-tree"))
