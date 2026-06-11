#!/usr/bin/env python3
"""
commit_queue.py — Serializes lane commits to the work branch.

Single-writer process. Listens on a Unix socket, applies patches via
git apply --3way, runs pre-commit hooks, and creates commits.

Usage:
  python3 scripts/commit_queue.py --run-id <run_id> [--socket <path>]
  python3 scripts/commit_queue.py --apply-patch <patch_file> --message <msg>
"""

import argparse
import fcntl
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

LOCK_FILE = Path(".datum/locks/branch.lock")
DEFAULT_SOCKET_TEMPLATE = ".datum/runs/{run_id}/commit-queue.sock"


def acquire_lock() -> int:
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd = open(  # noqa: SIM115  # nosemgrep: missing-oserror-on-file-open -- parent dir created above; lock fd kept open intentionally
        LOCK_FILE, "w"
    )
    fcntl.flock(fd, fcntl.LOCK_EX)
    return fd


def release_lock(fd: int) -> None:
    fcntl.flock(fd, fcntl.LOCK_UN)
    os.close(fd) if isinstance(fd, int) else fd.close()


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], capture_output=True, text=True)


def git_status_porcelain() -> str:
    lines = []
    for line in git("status", "--porcelain").stdout.splitlines():
        path = line[3:] if len(line) > 3 else line
        if path.startswith(".datum/"):
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def parse_patch_files(patch: str) -> set[str]:
    files: set[str] = set()
    for line in patch.splitlines():
        if line.startswith("+++ b/"):
            files.add(line[6:])
        elif line.startswith("--- a/"):
            path = line[6:]
            if path != "/dev/null":
                files.add(path)
    return {f for f in files if f and f != "/dev/null"}


def tracked_files_at(pre_sha: str) -> set[str]:
    result = git("ls-tree", "-r", "--name-only", pre_sha)
    return {line for line in result.stdout.splitlines() if line}


def restore_to_pre_sha(pre_sha: str, file_set: set[str]) -> None:
    """Restore queue-owned paths after a failure."""
    tracked_before = tracked_files_at(pre_sha)
    git("reset", "--hard", pre_sha)
    for file_path in file_set:
        if file_path in tracked_before:
            continue
        path = Path(file_path)
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists() or path.is_symlink():
            path.unlink()


def apply_patch_and_commit(
    patch: str, message: str, run_id: str, file_set: list[str] | None = None
) -> dict:
    """Apply a unified diff patch and create a commit. Returns result dict."""
    lock_fd = None
    try:
        lock_fd = acquire_lock()

        dirty = git_status_porcelain()
        if dirty:
            return {
                "ok": False,
                "error": "dirty_working_tree",
                "message": "Commit queue requires a clean worktree before applying lane patches.",
                "status": dirty.splitlines()[:20],
            }

        # Write patch to temp file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".patch", delete=False) as f:
            f.write(patch)
            patch_path = f.name

        try:
            # Fetch latest HEAD
            pre_sha = git("rev-parse", "HEAD").stdout.strip()
            allowed_files = set(file_set or []) or parse_patch_files(patch)
            if not allowed_files:
                return {
                    "ok": False,
                    "error": "missing_file_set",
                    "message": "Patch file set could not be inferred. Lane must submit file_set.",
                    "pre_sha": pre_sha,
                }

            # Apply patch
            apply = subprocess.run(
                ["git", "apply", "--3way", "--whitespace=fix", patch_path],
                capture_output=True,
                text=True,
            )

            if apply.returncode != 0:
                return {
                    "ok": False,
                    "error": "patch_apply_failed",
                    "stderr": apply.stderr[:500],
                    "pre_sha": pre_sha,
                }

            changed_files = {
                f for f in git("diff", "--name-only").stdout.splitlines() if f
            } | {
                f
                for f in git("diff", "--cached", "--name-only").stdout.splitlines()
                if f
            }
            unexpected = sorted(changed_files - allowed_files)
            if unexpected:
                restore_to_pre_sha(pre_sha, allowed_files | set(unexpected))
                return {
                    "ok": False,
                    "error": "patch_touched_undeclared_files",
                    "unexpected_files": unexpected,
                    "allowed_files": sorted(allowed_files),
                    "pre_sha": pre_sha,
                }

            if not changed_files:
                return {
                    "ok": False,
                    "error": "nothing_to_commit",
                    "message": "Patch applied no changes.",
                    "pre_sha": pre_sha,
                }

            # Stage only queue-owned files.
            git("add", "--", *sorted(changed_files))

            # Create commit (pre-commit hooks run automatically)
            commit = subprocess.run(
                ["git", "commit", "-m", message],
                capture_output=True,
                text=True,
                env={
                    **os.environ,
                    "GIT_AUTHOR_NAME": f"datum/{run_id}",
                    "GIT_AUTHOR_EMAIL": "datum@local",
                },
            )

            if commit.returncode != 0:
                # Pre-commit hook may have blocked. The queue started clean, so this
                # restore only removes queue-owned patch effects.
                restore_to_pre_sha(pre_sha, allowed_files)
                return {
                    "ok": False,
                    "error": "commit_failed",
                    "stderr": commit.stderr[:500],
                    "pre_sha": pre_sha,
                }

            post_sha = git("rev-parse", "HEAD").stdout.strip()

            # Archive the patch for replay
            archive_dir = Path(f".datum/runs/{run_id}/patches")
            archive_dir.mkdir(parents=True, exist_ok=True)
            import shutil

            shutil.copy(patch_path, archive_dir / f"{post_sha[:8]}.patch")

            return {"ok": True, "pre_sha": pre_sha, "post_sha": post_sha}

        finally:
            os.unlink(patch_path)

    finally:
        if lock_fd is not None:
            release_lock(lock_fd)


def handle_client(conn: socket.socket, run_id: str) -> None:
    """Handle one lane connection: read request, apply patch, send response."""
    try:
        data = b""
        while True:
            chunk = conn.recv(65536)
            if not chunk:
                break
            data += chunk
            if data.endswith(b"\n\n"):
                break

        request = json.loads(data.decode())
        patch = request.get("patch", "")
        message = request.get("commit_message", "datum: automated commit")
        file_set = request.get("file_set") or request.get("files")

        result = apply_patch_and_commit(patch, message, run_id, file_set=file_set)
        conn.sendall(json.dumps(result).encode() + b"\n")
    except Exception as e:
        conn.sendall(json.dumps({"ok": False, "error": str(e)}).encode() + b"\n")
    finally:
        conn.close()


def run_server(run_id: str, socket_path: str) -> None:
    """Run the commit queue server until SIGTERM."""
    sock_path = Path(socket_path)
    sock_path.parent.mkdir(parents=True, exist_ok=True)
    if sock_path.exists():
        sock_path.unlink()

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(str(sock_path))
    server.listen(32)
    print(json.dumps({"ok": True, "listening": str(sock_path)}), flush=True)

    try:
        while True:
            conn, _ = server.accept()
            t = threading.Thread(target=handle_client, args=(conn, run_id), daemon=True)
            t.start()
    except KeyboardInterrupt:
        pass
    finally:
        server.close()
        if sock_path.exists():
            sock_path.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(description="DATUM commit queue")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--socket")
    parser.add_argument("--apply-patch", help="Path to patch file (one-shot mode)")
    parser.add_argument("--message", help="Commit message for one-shot mode")
    args = parser.parse_args()

    if args.apply_patch:
        patch = Path(args.apply_patch).read_text()
        result = apply_patch_and_commit(
            patch, args.message or "datum: patch", args.run_id
        )
        print(json.dumps(result))
        sys.exit(0 if result["ok"] else 1)

    socket_path = args.socket or DEFAULT_SOCKET_TEMPLATE.format(run_id=args.run_id)
    run_server(args.run_id, socket_path)


if __name__ == "__main__":
    main()
