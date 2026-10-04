"""One-use, hash-checked preparation of two fork-only draft branches."""
from __future__ import annotations
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile

BASE = "8aff79ed2942be778e6cdba8237f902122cb37e1"
REPO = "luvs01/opencodex"
BRANCHES = {"codex/fix-pool-credit-policy-20261004", "codex/fix-standalone-pair-delivery-20261004"}
PREP = "codex/fork-fix-preparation-20261004"


def git(*args: str, data: bytes | None = None, env: dict[str, str] | None = None) -> bytes:
    result = subprocess.run(["git", *args], input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    if result.returncode:
        raise RuntimeError(f"git {args[0]} failed ({result.returncode}): " + result.stderr.decode(errors="replace"))
    return result.stdout


def safe_path(value: str) -> str:
    p = PurePosixPath(value)
    if p.is_absolute() or ".." in p.parts or "\\" in value or not p.parts or p.parts[0] not in {"src", "tests", "structure", "docs-site", "scripts"}:
        raise ValueError("Refused path: " + value)
    return value


def blob_sha(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def render(plan: dict, read, exists) -> dict[str, bytes]:
    changes: dict[str, bytes] = {}
    for item in plan["modified"]:
        name = safe_path(item["path"])
        raw = read(name)
        if blob_sha(raw) != item["original_blob_sha"]:
            raise ValueError("Original blob changed; no partial file replacement: " + name)
        text = raw.decode("utf-8")
        for operation in item["operations"]:
            old = operation["old"]
            expected = operation.get("expected_occurrences", 1)
            if not old or text.count(old) != expected:
                raise ValueError("Edit anchor mismatch: " + name + ": " + operation["label"])
            text = text.replace(old, operation["new"])
        changes[name] = text.encode("utf-8")
    for name, text in plan["new"].items():
        safe_path(name)
        if exists(name) or name in changes:
            raise ValueError("New path already exists: " + name)
        changes[name] = text.encode("utf-8")
    for name, addition in plan["append"].items():
        safe_path(name)
        raw = read(name)
        if name in changes or addition.strip() in raw.decode("utf-8"):
            raise ValueError("Duplicate documentation edit: " + name)
        changes[name] = raw + addition.encode("utf-8")
    for name, marker, nested in [
        ("scripts/test-layout/layout.json", '"explicit": {\n', True),
        ("tests/fixtures/test-layout-expected.json", "{\n", False),
    ]:
        text = read(name).decode("utf-8")
        parsed = json.loads(text)
        mapping = parsed["explicit"] if nested else parsed
        indent = "    " if nested else "  "
        for test_name, domain in plan["registrations"].items():
            if test_name in mapping:
                raise ValueError("Existing test registration: " + test_name)
            if f"tests/{domain}/{test_name}" not in plan["new"]:
                raise ValueError("Registration does not name an added test")
            entry = indent + json.dumps(test_name) + ": " + json.dumps(domain) + ",\n"
            if marker not in text:
                raise ValueError("Layout format changed: " + name)
            text = text.replace(marker, marker + entry, 1)
        updated = json.loads(text)
        actual = updated["explicit"] if nested else updated
        for key, value in plan["registrations"].items():
            if actual[key] != value:
                raise ValueError("Registration verification failed")
        changes[name] = text.encode("utf-8")
    return changes


def main() -> None:
    if os.environ.get("GITHUB_REPOSITORY") != REPO or os.environ.get("GITHUB_REF") != "refs/heads/" + PREP:
        raise RuntimeError("This preparation is confined to its named personal-fork branch")
    token = os.environ.get("GH_TOKEN")
    if not token:
        raise RuntimeError("Missing temporary workflow token")
    plans = [json.loads(Path(__file__).with_name(name).read_text()) for name in ("plan-credit.json", "plan-pairing.json")]
    if {p["branch"] for p in plans} != BRANCHES or len(plans) != 2:
        raise ValueError("Unexpected preparation target")
    env = dict(os.environ)
    env.update({"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "http.https://github.com/.extraheader",
                "GIT_CONFIG_VALUE_0": "AUTHORIZATION: basic " + base64.b64encode(("x-access-token:" + token).encode()).decode(),
                "GIT_AUTHOR_NAME": "github-actions[bot]", "GIT_COMMITTER_NAME": "github-actions[bot]",
                "GIT_AUTHOR_EMAIL": "41898282+github-actions[bot]@users.noreply.github.com",
                "GIT_COMMITTER_EMAIL": "41898282+github-actions[bot]@users.noreply.github.com"})
    origin = git("remote", "get-url", "origin").decode().strip()
    if origin not in {"https://github.com/" + REPO, "https://github.com/" + REPO + ".git"}:
        raise RuntimeError("Unexpected remote; no write performed")
    git("fetch", "--no-tags", "--depth=1", "origin", BASE, env=env)
    read = lambda name: git("show", f"{BASE}:{name}")
    def exists(name: str) -> bool:
        return subprocess.run(["git", "cat-file", "-e", f"{BASE}:{name}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    # Preflight both candidates before creating or publishing either branch.
    rendered = [(plan, render(plan, read, exists)) for plan in plans]
    for plan, _ in rendered:
        if git("ls-remote", "--heads", "origin", "refs/heads/" + plan["branch"], env=env).strip():
            raise RuntimeError("Target branch already exists; refusing overwrite: " + plan["branch"])
    commits = []
    for plan, changes in rendered:
        with tempfile.TemporaryDirectory(prefix="ocx-fork-index-") as tmp:
            commit_env = {**env, "GIT_INDEX_FILE": str(Path(tmp) / "index")}
            git("read-tree", BASE, env=commit_env)
            for name, data in changes.items():
                sha = git("hash-object", "-w", "--stdin", data=data).decode().strip()
                git("update-index", "--add", "--cacheinfo", f"100644,{sha},{name}", env=commit_env)
            tree = git("write-tree", env=commit_env).decode().strip()
            git("diff", "--check", BASE, tree, env=commit_env)
            message = plan["message"] + "\n\nPrepared from the pinned fork dev tree with exact original blob checks.\nDraft candidate: full Bun and native-platform validation remain required.\n"
            commit = git("commit-tree", tree, "-p", BASE, data=message.encode(), env=commit_env).decode().strip()
            if not re.fullmatch(r"[0-9a-f]{40}", commit):
                raise RuntimeError("Invalid generated commit")
            commits.append((plan["branch"], commit, tree, len(changes)))
    # No force-push or integration-branch mutation. Publish only two new refs.
    git("push", "--atomic", "origin", *(sha + ":refs/heads/" + branch for branch, sha, _, _ in commits), env=env)
    for branch, sha, tree, count in commits:
        print(json.dumps({"branch": branch, "commit": sha, "tree": tree, "files": count}))
    # Preparation files do not enter either result tree.


if __name__ == "__main__":
    main()
