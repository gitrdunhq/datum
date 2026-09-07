#!/usr/bin/env python3
"""Commit synthesis artifacts to main. Idempotent."""

import json
import subprocess
import sys
from pathlib import Path

SYNTHESIS_FILES = [
    "CURRENT_STATE.md",
    "ROADMAP.md",
    "CHANGELOG.md",
    "RETRO.md",
    "solutions/",
]


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], capture_output=True, text=True)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    marker = Path(f".datum/runs/{args.run_id}/.commit-closeout.done")
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True}))
        return

    # Check if a closeout commit already exists (with exact subject matching)
    log_result = git("log", "--grep", f"closeout: {args.run_id}", "--format=%s")
    subjects = (
        log_result.stdout.strip().split("\n") if log_result.stdout.strip() else []
    )
    closeout_subject = f"closeout: {args.run_id}"
    if any(s == closeout_subject for s in subjects):
        marker.write_text("done")
        print(
            json.dumps(
                {
                    "ok": True,
                    "skipped": True,
                    "reason": "closeout commit already exists",
                }
            )
        )
        return

    staged = []
    for f in SYNTHESIS_FILES:
        p = Path(f)
        if p.exists():
            result = git("add", str(p))
            if result.returncode != 0:
                print(
                    json.dumps(
                        {
                            "ok": False,
                            "error": f"Failed to stage {f}: {result.stderr[:300]}",
                        }
                    )
                )
                sys.exit(1)
            staged.append(f)

    if not staged:
        print(
            json.dumps(
                {"ok": True, "skipped": True, "reason": "no synthesis files to commit"}
            )
        )
        return

    result = git(
        "commit",
        "-m",
        f"closeout: {args.run_id}\n\nPost-epic documentation and state update.\n\nDATUM-Closeout: {args.run_id}",
    )
    if result.returncode != 0:
        err_out = result.stderr + result.stdout
        if "guard-main-commit" in err_out or "Direct commits" in err_out:
            branch_name = f"chore/{args.run_id}-closeout"
            git("checkout", "-b", branch_name)
            res_commit = git(
                "commit",
                "-m",
                f"closeout: {args.run_id}\n\nPost-epic documentation and state update.\n\nDATUM-Closeout: {args.run_id}",
            )
            if res_commit.returncode != 0:
                print(json.dumps({"ok": False, "error": res_commit.stderr[:300]}))
                sys.exit(1)

            push_result = git("push", "-u", "origin", branch_name)
            if push_result.returncode != 0:
                sha = subprocess.run(
                    ["git", "rev-parse", "HEAD"],
                    cwd=".",
                    capture_output=True,
                    text=True,
                ).stdout.strip()
                print(
                    json.dumps(
                        {
                            "ok": False,
                            "error": f"git push failed: {push_result.stderr[:300]}",
                            "sha": sha,
                        }
                    )
                )
                sys.exit(1)

            import shutil

            if shutil.which("gh") is None:
                # gh not on PATH, skip PR creation but don't fail
                marker.write_text("done")
                sha = subprocess.run(
                    ["git", "rev-parse", "HEAD"],
                    cwd=".",
                    capture_output=True,
                    text=True,
                ).stdout.strip()
                print(
                    json.dumps(
                        {
                            "ok": True,
                            "pr_created": False,
                            "reason": "gh not on PATH",
                            "branch": branch_name,
                            "files": staged,
                            "sha": sha,
                        }
                    )
                )
                return

            gh_result = subprocess.run(
                [
                    "gh",
                    "pr",
                    "create",
                    "--title",
                    f"Closeout: {args.run_id}",
                    "--body",
                    f"Automated closeout PR for {args.run_id}",
                ],
                capture_output=True,
                text=True,
            )

            if gh_result.returncode != 0:
                sha = subprocess.run(
                    ["git", "rev-parse", "HEAD"],
                    cwd=".",
                    capture_output=True,
                    text=True,
                ).stdout.strip()
                print(
                    json.dumps(
                        {
                            "ok": False,
                            "error": f"gh pr create failed: {gh_result.stderr[:300]}",
                            "sha": sha,
                        }
                    )
                )
                sys.exit(1)

            marker.write_text("done")
            print(
                json.dumps(
                    {
                        "ok": True,
                        "pr_created": True,
                        "branch": branch_name,
                        "files": staged,
                    }
                )
            )
            return

        print(json.dumps({"ok": False, "error": result.stderr[:300]}))
        sys.exit(1)

    sha = git("rev-parse", "HEAD").stdout.strip()
    marker.write_text("done")
    print(json.dumps({"ok": True, "sha": sha, "files": staged}))


if __name__ == "__main__":
    main()
