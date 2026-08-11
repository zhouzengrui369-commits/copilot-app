#!/usr/bin/env python3
import fnmatch
import json
import re
import subprocess
import sys
from pathlib import Path

WORKSPACE = Path("/Users/njx/openclaw/copilot.wt-S15C")
TASK_DIR_REL = "tasks/openclaw/2026-07-29-owner-gate-stage0-recovery"
R3_MANIFEST = Path(
    "/Users/njx/openclaw/copilot/.worktrees/exp-cop-p0/tasks/openclaw/"
    "2026-07-28-current-desktop-source-snapshot-r3/SOURCE_SNAPSHOT_MANIFEST.json"
)
OUTPUT = WORKSPACE / TASK_DIR_REL / "SCOPE_AND_SECRET_SCAN.json"

GOVERNANCE_PATHS = {
    "README.md",
    "PROJECT_STATE.yaml",
    "PROJECT_STATUS.md",
    "TODO.md",
    "CHANGELOG.md",
    "DECISIONS.md",
    "docs/ARCHITECTURE.md",
}

SECRET_RULES = [
    ("OPENAI_SK", re.compile(rb"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b")),
    ("PRIVATE_KEY_BLOCK", re.compile(rb"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")),
    ("AWS_ACCESS_KEY_ID", re.compile(rb"\bAKIA[0-9A-Z]{16}\b")),
    ("TENCENT_SECRET_ID", re.compile(rb"\bAKID[0-9A-Za-z]{16,}\b")),
    (
        "GENERIC_SECRET_ASSIGNMENT",
        re.compile(
            rb"(?i)\b(?:api[_-]?key|secret|password|access[_-]?token|refresh[_-]?token)"
            rb"\b\s*[:=]\s*['\"][A-Za-z0-9_./+=-]{24,}['\"]"
        ),
    ),
]


def run_git(args):
    result = subprocess.run(
        ["git", *args],
        cwd=str(WORKSPACE),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", "replace"))
    return result.stdout.decode("utf-8", "replace")


def parse_status_paths(status):
    paths = []
    for line in status.splitlines():
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        paths.append({"status": line[:2], "path": path})
    return paths


def is_allowed_product_path(path, scope, manifest_paths, deletion_paths):
    if path in manifest_paths or path in deletion_paths:
        return True
    if path in scope["rootExactFiles"] or path in scope["appExactFiles"]:
        return True
    for root in scope["recursiveRoots"]:
        if path == root or path.startswith(root + "/"):
            return True
    app_root = "apps/copilot-desktop"
    if path.startswith(app_root + "/") and "/" not in path[len(app_root) + 1 :]:
        name = path.rsplit("/", 1)[-1]
        if any(fnmatch.fnmatch(name, pattern) for pattern in scope["appRootPatterns"]):
            return True
    for root in scope["packageRoots"]:
        if path.startswith(root + "/") and "/" not in path[len(root) + 1 :]:
            name = path.rsplit("/", 1)[-1]
            if any(
                fnmatch.fnmatch(name, pattern)
                for pattern in scope["packageRootPatterns"]
            ):
                return True
    return False


def is_test_fixture_path(path):
    name = Path(path).name
    return (
        "/tests/" in path
        or name.endswith(".test.ts")
        or name.endswith(".test.tsx")
        or name.endswith(".spec.ts")
        or name.endswith(".spec.tsx")
    )


def scan_secret_patterns(paths):
    unclassified = []
    classified_test_fixtures = []
    for item in paths:
        path = item["path"]
        full = WORKSPACE / path
        if not full.is_file() or full.is_symlink():
            continue
        data = full.read_bytes()
        for line_number, line in enumerate(data.splitlines(), 1):
            for rule_name, pattern in SECRET_RULES:
                if not pattern.search(line):
                    continue
                match = {"path": path, "rule": rule_name, "line": line_number}
                if is_test_fixture_path(path):
                    classified_test_fixtures.append(match)
                else:
                    unclassified.append(match)
    return unclassified, classified_test_fixtures


def main():
    manifest = json.loads(R3_MANIFEST.read_text(encoding="utf-8"))
    scope = manifest["scope"]
    manifest_paths = {entry["path"] for entry in manifest["entries"]}
    deletion_paths = {entry["path"] for entry in manifest["trackedDeletions"]}
    status = run_git(["status", "--short", "--untracked-files=all"])
    paths = parse_status_paths(status)
    outside = []
    for item in paths:
        path = item["path"]
        allowed = (
            path in GOVERNANCE_PATHS
            or path == TASK_DIR_REL
            or path.startswith(TASK_DIR_REL + "/")
            or is_allowed_product_path(path, scope, manifest_paths, deletion_paths)
        )
        if not allowed:
            outside.append(item)
    secret_matches, test_fixture_matches = scan_secret_patterns(paths)
    payload = {
        "status": "PASS" if not outside and not secret_matches else "FAIL",
        "changedPathCount": len(paths),
        "outsideAllowedScope": outside,
        "unclassifiedSecretMatches": secret_matches,
        "classifiedTestFixtureMatches": test_fixture_matches,
        "secretScanRules": [name for name, _ in SECRET_RULES],
        "contentPolicy": "only path, line, and rule names are recorded; matched content is not emitted",
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    if payload["status"] != "PASS":
        sys.exit(1)


if __name__ == "__main__":
    main()
