#!/usr/bin/env python3
import argparse
import fnmatch
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

WORKSPACE = Path("/Users/njx/openclaw/copilot.wt-S15C")
TASK_DIR = WORKSPACE / "tasks/openclaw/2026-07-29-owner-gate-stage0-recovery"
R3_TASK = Path(
    "/Users/njx/openclaw/copilot/.worktrees/exp-cop-p0/tasks/openclaw/"
    "2026-07-28-current-desktop-source-snapshot-r3"
)
R3_MANIFEST = R3_TASK / "SOURCE_SNAPSHOT_MANIFEST.json"
R3_SNAPSHOT_SOURCE = R3_TASK / "snapshot/source"
OUTPUT_MANIFEST = TASK_DIR / "MATERIALIZED_SOURCE_MANIFEST.json"

EXPECTED_BRANCH = "codex/p0-owner-gate"
EXPECTED_HEAD = "96c861706126317c27965fcb64c765973df9ac89"
EXPECTED_R3_MANIFEST_SHA = (
    "3425aba76d6d79b326b11b178ec96ad306ac8364feba84420f5ce9a2de812ec4"
)
EXPECTED_R3_AGGREGATE = (
    "026060bbc505e7f5fafceae98df600e067b97aaedbd087e2248195e74fd7f311"
)
EXPECTED_ENTRIES = 414
EXPECTED_DELETIONS = 7
EXPECTED_BYTES = 51347389
SCHEMA_VERSION = "copilot-current-desktop-source-snapshot/v3"
AGGREGATE_ALGORITHM = (
    "SHA256(UTF8 compact JSON-array records joined by LF with final LF; "
    "SCHEMA first, then F entries by UTF8 path bytes, then D deletions by "
    "UTF8 path bytes)"
)


def fail(message):
    print(json.dumps({"status": "FAIL_CLOSED", "reason": message}, ensure_ascii=False))
    sys.exit(1)


def run_git(args):
    completed = subprocess.run(
        ["git", *args],
        cwd=str(WORKSPACE),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode != 0:
        fail(
            "GIT_COMMAND_FAILED "
            + " ".join(args)
            + " stderr="
            + completed.stderr.decode("utf-8", "replace")
        )
    return completed.stdout


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    with path.open("rb") as handle:
        return sha256_bytes(handle.read())


def read_json(path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def utf8_key(value):
    return value.encode("utf-8")


def canonical_aggregate(entries, deletions):
    records = [
        json.dumps(["SCHEMA", SCHEMA_VERSION], ensure_ascii=False, separators=(",", ":"))
    ]
    for entry in sorted(entries, key=lambda item: utf8_key(str(item["path"]))):
        records.append(
            json.dumps(
                [
                    "F",
                    entry["path"],
                    entry["status"],
                    entry["mode"],
                    entry["bytes"],
                    entry["sha256"],
                ],
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
    for deletion in sorted(deletions, key=lambda item: utf8_key(str(item["path"]))):
        records.append(
            json.dumps(
                [
                    "D",
                    deletion["path"],
                    deletion["status"],
                    deletion["reason"],
                    deletion["lastKnownFrom"],
                    deletion["mode"],
                    deletion["bytes"],
                    deletion["sha256"],
                ],
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
    data = ("\n".join(records) + "\n").encode("utf-8")
    return {
        "algorithm": AGGREGATE_ALGORITHM,
        "canonicalBytes": len(data),
        "sha256": sha256_bytes(data),
    }


def clean_status_except_task():
    raw = run_git(["status", "--porcelain=v1", "--untracked-files=all"]).decode(
        "utf-8", "replace"
    )
    violations = []
    for line in raw.splitlines():
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        if not path.startswith("tasks/openclaw/2026-07-29-owner-gate-stage0-recovery/"):
            violations.append(line)
    if violations:
        fail("PRE_STATUS_NOT_CLEAN_OUTSIDE_TASK_DIR " + repr(violations[:20]))
    return raw


def git_status_text():
    return run_git(["status", "--short", "--untracked-files=all"]).decode(
        "utf-8", "replace"
    )


def assert_preflight(skip_clean):
    branch = run_git(["rev-parse", "--abbrev-ref", "HEAD"]).decode().strip()
    head = run_git(["rev-parse", "HEAD"]).decode().strip()
    if branch != EXPECTED_BRANCH:
        fail(f"BRANCH_MISMATCH expected={EXPECTED_BRANCH} actual={branch}")
    if head != EXPECTED_HEAD:
        fail(f"HEAD_MISMATCH expected={EXPECTED_HEAD} actual={head}")
    if sha256_file(R3_MANIFEST) != EXPECTED_R3_MANIFEST_SHA:
        fail("R3_MANIFEST_SHA_MISMATCH")
    if not skip_clean:
        clean_status_except_task()
    review = (R3_TASK / "INDEPENDENT_SNAPSHOT_POSTIMAGE_REVIEW.md").read_text(
        encoding="utf-8"
    )
    if "SNAPSHOT_POSTIMAGE=PASS" not in review:
        fail("R3_SNAPSHOT_POSTIMAGE_PASS_MISSING")
    if "MATERIALIZATION_INPUT_AUTHORIZED=YES" not in review:
        fail("R3_MATERIALIZATION_AUTHORIZATION_MISSING")
    return {"branch": branch, "head": head}


def assert_safe_relpath(relative):
    if relative.startswith("/") or "\x00" in relative:
        fail(f"UNSAFE_PATH {relative!r}")
    parts = Path(relative).parts
    if any(part in ("", ".", "..") for part in parts):
        fail(f"UNSAFE_PATH {relative!r}")


def ensure_safe_parent(destination):
    parent = destination.parent
    parent.mkdir(parents=True, exist_ok=True)
    current = WORKSPACE
    for part in destination.relative_to(WORKSPACE).parent.parts:
        current = current / part
        if current.is_symlink():
            fail(f"SYMLINK_PARENT_REFUSED {current.relative_to(WORKSPACE)}")


def copy_entry(relative):
    assert_safe_relpath(relative)
    source = R3_SNAPSHOT_SOURCE / relative
    destination = WORKSPACE / relative
    if not source.is_file() or source.is_symlink():
        fail(f"SNAPSHOT_SOURCE_NOT_REGULAR {relative}")
    ensure_safe_parent(destination)
    if destination.exists() and destination.is_dir():
        fail(f"DESTINATION_IS_DIRECTORY {relative}")
    if destination.is_symlink():
        destination.unlink()
    shutil.copyfile(source, destination)
    os.chmod(destination, 0o644)


def unlink_target(relative, reason, removed):
    assert_safe_relpath(relative)
    target = WORKSPACE / relative
    if not target.exists() and not target.is_symlink():
        return
    if target.is_dir() and not target.is_symlink():
        fail(f"DELETE_TARGET_IS_DIRECTORY {relative}")
    target.unlink()
    removed.append({"path": relative, "reason": reason})


def has_excluded_segment(relative, excluded_segments):
    return any(part in excluded_segments for part in Path(relative).parts)


def mirror_recursive_roots(scope, manifest_paths, removed):
    excluded_segments = set(scope["excludedSegments"])
    excluded_names = set(scope["excludedFileNames"])
    for root in scope["recursiveRoots"]:
        root_path = WORKSPACE / root
        if not root_path.exists():
            continue
        if root_path.is_symlink() or not root_path.is_dir():
            fail(f"RECURSIVE_ROOT_NOT_DIRECTORY {root}")
        for dirpath, dirnames, filenames in os.walk(root_path, topdown=True):
            dirnames[:] = [
                name
                for name in dirnames
                if name not in excluded_segments and name not in excluded_names
            ]
            for filename in filenames:
                path = Path(dirpath) / filename
                relative = path.relative_to(WORKSPACE).as_posix()
                if filename in excluded_names or has_excluded_segment(
                    relative, excluded_segments
                ):
                    continue
                if relative not in manifest_paths:
                    if path.is_symlink() or path.is_file():
                        unlink_target(relative, "recursive_root_extra_file", removed)
                    else:
                        fail(f"RECURSIVE_EXTRA_NON_REGULAR {relative}")


def mirror_root_patterns(scope, manifest_paths, removed):
    pattern_sets = [
        ("apps/copilot-desktop", scope["appRootPatterns"], "app_root_pattern_extra"),
    ]
    for package_root in scope["packageRoots"]:
        pattern_sets.append(
            (package_root, scope["packageRootPatterns"], "package_root_pattern_extra")
        )
    for root, patterns, reason in pattern_sets:
        root_path = WORKSPACE / root
        if not root_path.exists():
            continue
        for child in root_path.iterdir():
            relative = child.relative_to(WORKSPACE).as_posix()
            if child.is_dir() and not child.is_symlink():
                continue
            if any(fnmatch.fnmatch(child.name, pattern) for pattern in patterns):
                if relative not in manifest_paths:
                    if child.is_symlink() or child.is_file():
                        unlink_target(relative, reason, removed)
                    else:
                        fail(f"PATTERN_EXTRA_NON_REGULAR {relative}")


def materialize(manifest):
    removed = []
    manifest_paths = {entry["path"] for entry in manifest["entries"]}
    for entry in manifest["entries"]:
        copy_entry(entry["path"])
    mirror_recursive_roots(manifest["scope"], manifest_paths, removed)
    mirror_root_patterns(manifest["scope"], manifest_paths, removed)
    for deletion in manifest["trackedDeletions"]:
        unlink_target(deletion["path"], "manifest_tracked_deletion", removed)
    return removed


def read_current_entry(entry):
    relative = entry["path"]
    target = WORKSPACE / relative
    if not target.is_file() or target.is_symlink():
        fail(f"MATERIALIZED_ENTRY_MISSING_OR_NOT_REGULAR {relative}")
    data = target.read_bytes()
    mode = stat.S_IMODE(target.stat().st_mode)
    return {
        "path": relative,
        "status": entry["status"],
        "mode": format(mode, "04o"),
        "bytes": len(data),
        "sha256": sha256_bytes(data),
    }


def verify_materialized(manifest):
    verified = [read_current_entry(entry) for entry in manifest["entries"]]
    mismatches = []
    for expected, actual in zip(manifest["entries"], verified):
        for key in ("path", "status", "mode", "bytes", "sha256"):
            if expected[key] != actual[key]:
                mismatches.append({"path": expected["path"], "key": key})
    for deletion in manifest["trackedDeletions"]:
        target = WORKSPACE / deletion["path"]
        if target.exists() or target.is_symlink():
            fail(f"TRACKED_DELETION_STILL_EXISTS {deletion['path']}")
    if mismatches:
        fail("MATERIALIZED_ENTRY_MISMATCH " + json.dumps(mismatches[:20]))
    total_bytes = sum(entry["bytes"] for entry in verified)
    aggregate = canonical_aggregate(verified, manifest["trackedDeletions"])
    if len(verified) != EXPECTED_ENTRIES:
        fail(f"ENTRY_COUNT_MISMATCH {len(verified)}")
    if len(manifest["trackedDeletions"]) != EXPECTED_DELETIONS:
        fail(f"DELETION_COUNT_MISMATCH {len(manifest['trackedDeletions'])}")
    if total_bytes != EXPECTED_BYTES:
        fail(f"BYTE_COUNT_MISMATCH {total_bytes}")
    if aggregate["sha256"] != EXPECTED_R3_AGGREGATE:
        fail(f"AGGREGATE_MISMATCH {aggregate['sha256']}")
    return verified, total_bytes, aggregate


def validate_manifest_identity(manifest):
    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        fail("R3_SCHEMA_MISMATCH")
    if manifest.get("counts", {}).get("entries") != EXPECTED_ENTRIES:
        fail("R3_ENTRY_COUNT_MISMATCH")
    if manifest.get("counts", {}).get("trackedDeletions") != EXPECTED_DELETIONS:
        fail("R3_DELETION_COUNT_MISMATCH")
    if manifest.get("counts", {}).get("snapshotBytes") != EXPECTED_BYTES:
        fail("R3_BYTE_COUNT_MISMATCH")
    if manifest.get("aggregate", {}).get("sha256") != EXPECTED_R3_AGGREGATE:
        fail("R3_AGGREGATE_MISMATCH")
    if canonical_aggregate(manifest["entries"], manifest["trackedDeletions"]) != manifest[
        "aggregate"
    ]:
        fail("R3_AGGREGATE_RECOMPUTE_MISMATCH")


def write_output_manifest(preflight, mode, removed, verified, total_bytes, aggregate):
    payload = {
        "schemaVersion": "copilot-owner-gate-stage0-materialized-source/v1",
        "status": "STAGE0_MATERIALIZATION_PASS / COMMIT_PENDING / MVP_NOT_COMPLETE",
        "mode": mode,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "workspace": str(WORKSPACE),
        "git": {
            "baseCommit": EXPECTED_HEAD,
            "branch": preflight["branch"],
            "head": preflight["head"],
            "worktreeStatus": "DIRTY_EXPECTED_COMMIT_PENDING",
            "statusShort": git_status_text().splitlines(),
        },
        "inputs": {
            "r3Task": str(R3_TASK),
            "r3ManifestSha256": EXPECTED_R3_MANIFEST_SHA,
            "r3AggregateSha256": EXPECTED_R3_AGGREGATE,
            "r3IndependentVerdict": (
                "SNAPSHOT_POSTIMAGE=PASS / MATERIALIZATION_INPUT_AUTHORIZED=YES"
            ),
            "productReviewPr": "https://github.com/zhouzengrui369-commits/copilot-app/pull/9",
            "focusedReport": "https://github.com/zhouzengrui369-commits/copilot-app/blob/31dfd0c7f9feca77da82f4a02bf359d85818742c/reports/product-review/2026-07-28-copilot-focused-retest.md",
            "reviewVerdict": "NOT_READY / BLOCKED_EXP_COP_008 / P0=1 / P1=6 / P2=3",
            "ecosystemBaseline": {
                "repository": "zhouzengrui369-commits/knowme-ecosystem",
                "version": "0.2.0",
                "commit": "965713b81a726279f63527eb17979f5e768423c1",
            },
        },
        "materialized": {
            "entries": len(verified),
            "trackedDeletions": EXPECTED_DELETIONS,
            "snapshotBytes": total_bytes,
            "aggregate": aggregate,
            "modeCounts": {"0644": len(verified)},
            "removedExtraFiles": removed,
            "trackedDeletionPaths": [
                deletion["path"] for deletion in read_json(R3_MANIFEST)["trackedDeletions"]
            ],
        },
        "entries": verified,
        "trackedDeletions": read_json(R3_MANIFEST)["trackedDeletions"],
    }
    OUTPUT_MANIFEST.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    preflight = assert_preflight(skip_clean=args.verify_only)
    manifest = read_json(R3_MANIFEST)
    validate_manifest_identity(manifest)
    removed = [] if args.verify_only else materialize(manifest)
    verified, total_bytes, aggregate = verify_materialized(manifest)
    output = write_output_manifest(
        preflight,
        "verify-only" if args.verify_only else "materialize",
        removed,
        verified,
        total_bytes,
        aggregate,
    )
    print(
        json.dumps(
            {
                "status": output["status"],
                "mode": output["mode"],
                "entries": output["materialized"]["entries"],
                "trackedDeletions": output["materialized"]["trackedDeletions"],
                "snapshotBytes": output["materialized"]["snapshotBytes"],
                "aggregateSha256": output["materialized"]["aggregate"]["sha256"],
                "removedExtraFiles": len(removed),
                "manifest": str(OUTPUT_MANIFEST),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
